-- PDE-26: independent exceptional-restriction and appeal workflow.
-- A restriction never updates or deletes the published row. It withholds the
-- bytes on public surfaces behind a non-misleading public notice while the
-- contribution's existence, attribution, counts and sequence position remain.
-- Campaign ownership is never moderation authority (defense in depth below).

CREATE TABLE IF NOT EXISTS restriction_cases(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 target_kind text NOT NULL CHECK (target_kind IN ('submission','document','derivative')),
 target_id uuid NOT NULL,
 debate_id uuid NOT NULL REFERENCES debates(id),
 reason_category text NOT NULL CHECK (reason_category IN ('malware_or_security','unlawful_content','private_information','legal_order','impersonation')),
 status text NOT NULL DEFAULT 'active' CHECK (status IN ('active','lifted')),
 opened_by_account_id uuid NOT NULL REFERENCES accounts(id),
 opened_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS restriction_one_active_case_per_target ON restriction_cases(target_kind,target_id) WHERE status='active';
CREATE INDEX IF NOT EXISTS restriction_cases_debate_idx ON restriction_cases(debate_id,opened_at,id);

CREATE TABLE IF NOT EXISTS restriction_events(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 case_id uuid NOT NULL REFERENCES restriction_cases(id),
 event_order integer NOT NULL CHECK (event_order>0),
 event_type text NOT NULL CHECK (event_type IN ('opened','appealed','upheld','lifted')),
 actor_account_id uuid NOT NULL REFERENCES accounts(id),
 public_notice text NOT NULL CHECK (length(btrim(public_notice)) BETWEEN 20 AND 1000),
 private_basis text CHECK (private_basis IS NULL OR length(btrim(private_basis)) BETWEEN 1 AND 4000),
 independent_review boolean NOT NULL DEFAULT false,
 occurred_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 UNIQUE(case_id,event_order)
);
CREATE INDEX IF NOT EXISTS restriction_events_case_idx ON restriction_events(case_id,event_order);

-- Debate of a published target, or NULL when the target is not a public item.
CREATE OR REPLACE FUNCTION public.pde_restriction_target_debate(p_kind text,p_target uuid) RETURNS uuid LANGUAGE sql STABLE AS $$
 SELECT CASE p_kind
  WHEN 'submission' THEN (SELECT s.debate_id FROM submissions s JOIN debates d ON d.id=s.debate_id WHERE s.id=p_target AND s.published_at IS NOT NULL AND d.status='published')
  WHEN 'document' THEN (SELECT s.debate_id FROM submission_documents doc JOIN submissions s ON s.id=doc.submission_id JOIN debates d ON d.id=s.debate_id WHERE doc.id=p_target AND s.published_at IS NOT NULL AND d.status='published')
  WHEN 'derivative' THEN (SELECT b.debate_id FROM derivative_artifacts a JOIN debate_branches b ON b.id=a.branch_id JOIN debates d ON d.id=b.debate_id WHERE a.id=p_target AND a.status='released' AND d.status='published')
 END
$$;

-- Accounts that published the item and may therefore appeal.
CREATE OR REPLACE FUNCTION public.pde_restriction_target_owner_accounts(p_kind text,p_target uuid) RETURNS SETOF uuid LANGUAGE sql STABLE AS $$
 SELECT c.account_id FROM submissions s JOIN candidacies c ON c.id=s.candidacy_id WHERE p_kind='submission' AND s.id=p_target
 UNION
 SELECT c.account_id FROM submission_documents doc JOIN candidacies c ON c.id=doc.uploaded_by_candidacy_id WHERE p_kind='document' AND doc.id=p_target
 UNION
 SELECT c.account_id FROM derivative_approvals x JOIN candidacies c ON c.id=x.candidacy_id WHERE p_kind='derivative' AND x.artifact_id=p_target
$$;

-- True when the account owns, or holds an active campaign role for, any
-- candidacy participating in the debate (originator or any branch responder).
CREATE OR REPLACE FUNCTION public.pde_account_participates_in_debate(account uuid,debate uuid) RETURNS boolean LANGUAGE sql STABLE AS $$
 WITH participants AS (
  SELECT d.originator_candidacy_id AS candidacy_id FROM debates d WHERE d.id=debate
  UNION SELECT b.responder_candidacy_id FROM debate_branches b WHERE b.debate_id=debate
 )
 SELECT EXISTS(SELECT 1 FROM participants p JOIN candidacies c ON c.id=p.candidacy_id WHERE c.account_id=account)
     OR EXISTS(SELECT 1 FROM participants p JOIN campaign_memberships m ON m.candidacy_id=p.candidacy_id WHERE m.account_id=account AND m.revoked_at IS NULL)
$$;

-- Active case restricting a public item. 'media' resolves through its submission;
-- a derivative is also restricted while any clip source submission is restricted.
CREATE OR REPLACE FUNCTION public.pde_active_restriction_case(p_kind text,p_target uuid) RETURNS uuid LANGUAGE sql STABLE AS $$
 SELECT CASE p_kind
  WHEN 'submission' THEN (SELECT rc.id FROM restriction_cases rc WHERE rc.target_kind='submission' AND rc.target_id=p_target AND rc.status='active')
  WHEN 'media' THEN (SELECT rc.id FROM submissions s JOIN restriction_cases rc ON rc.target_kind='submission' AND rc.target_id=s.id AND rc.status='active' WHERE s.media_asset_id=p_target LIMIT 1)
  WHEN 'document' THEN (SELECT rc.id FROM restriction_cases rc WHERE rc.target_kind='document' AND rc.target_id=p_target AND rc.status='active')
  WHEN 'derivative' THEN COALESCE(
   (SELECT rc.id FROM restriction_cases rc WHERE rc.target_kind='derivative' AND rc.target_id=p_target AND rc.status='active'),
   (SELECT rc.id FROM derivative_artifacts a
     CROSS JOIN LATERAL jsonb_array_elements(CASE WHEN jsonb_typeof(a.source_manifest->'clips')='array' THEN a.source_manifest->'clips' ELSE '[]'::jsonb END) clip
     JOIN submissions s ON s.media_asset_id::text=clip->>'mediaAssetId'
     JOIN restriction_cases rc ON rc.target_kind='submission' AND rc.target_id=s.id AND rc.status='active'
    WHERE a.id=p_target ORDER BY rc.opened_at LIMIT 1))
 END
$$;

-- Public notice for an active restriction: only public fields, never account ids
-- or the private basis.
CREATE OR REPLACE FUNCTION public.pde_public_restriction(p_kind text,p_target uuid) RETURNS jsonb LANGUAGE sql STABLE AS $$
 SELECT jsonb_build_object(
  'caseId',rc.id,'targetKind',rc.target_kind,'inherited',NOT (rc.target_kind=p_kind AND rc.target_id=p_target),
  'category',rc.reason_category,'openedAt',rc.opened_at,
  'publicNotice',(SELECT e.public_notice FROM restriction_events e WHERE e.case_id=rc.id AND e.event_type='opened'),
  'appealStatus',(SELECT CASE WHEN (SELECT e.event_type FROM restriction_events e WHERE e.case_id=rc.id ORDER BY e.event_order DESC LIMIT 1)='appealed' THEN 'pending'
     WHEN EXISTS(SELECT 1 FROM restriction_events e WHERE e.case_id=rc.id AND e.event_type='upheld') THEN 'upheld' ELSE 'none' END))
 FROM restriction_cases rc WHERE rc.id=public.pde_active_restriction_case(p_kind,p_target)
$$;

CREATE OR REPLACE FUNCTION public.pde_guard_restriction_case() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE target_debate uuid;
BEGIN
 IF TG_OP='DELETE' THEN RAISE EXCEPTION 'Restriction cases are retained permanently.' USING ERRCODE='55000'; END IF;
 IF TG_OP='INSERT' THEN
  IF NEW.status<>'active' THEN RAISE EXCEPTION 'A restriction case opens as active.' USING ERRCODE='23514'; END IF;
  target_debate:=public.pde_restriction_target_debate(NEW.target_kind,NEW.target_id);
  IF target_debate IS NULL THEN RAISE EXCEPTION 'Only a published item can be restricted.' USING ERRCODE='23514'; END IF;
  IF NEW.debate_id IS DISTINCT FROM target_debate THEN RAISE EXCEPTION 'Restriction debate does not match its target.' USING ERRCODE='23514'; END IF;
  IF NOT EXISTS(SELECT 1 FROM accounts a WHERE a.id=NEW.opened_by_account_id AND a.status='active') THEN
   RAISE EXCEPTION 'Restriction opener must be an active account.' USING ERRCODE='23514'; END IF;
  IF public.pde_account_participates_in_debate(NEW.opened_by_account_id,NEW.debate_id) THEN
   RAISE EXCEPTION 'A debate participant or campaign member cannot open a restriction in that debate.' USING ERRCODE='23514'; END IF;
  RETURN NEW;
 END IF;
 IF OLD.status<>'active' OR NEW.status<>'lifted' OR (to_jsonb(NEW)-'status') IS DISTINCT FROM (to_jsonb(OLD)-'status') THEN
  RAISE EXCEPTION 'A restriction case may only change once, from active to lifted.' USING ERRCODE='55000'; END IF;
 IF NOT EXISTS(SELECT 1 FROM restriction_events e WHERE e.case_id=NEW.id AND e.event_type='lifted') THEN
  RAISE EXCEPTION 'Lifting requires a recorded lifted event.' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER pde_restriction_case_guard BEFORE INSERT OR UPDATE OR DELETE ON restriction_cases
 FOR EACH ROW EXECUTE FUNCTION public.pde_guard_restriction_case();

CREATE OR REPLACE FUNCTION public.pde_guard_restriction_event() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE c restriction_cases%ROWTYPE; last_type text; last_order integer; last_at timestamptz;
BEGIN
 SELECT * INTO c FROM restriction_cases WHERE id=NEW.case_id FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Restriction case not found.' USING ERRCODE='23503'; END IF;
 SELECT e.event_type,e.event_order,e.occurred_at INTO last_type,last_order,last_at FROM restriction_events e WHERE e.case_id=NEW.case_id ORDER BY e.event_order DESC LIMIT 1;
 NEW.event_order:=COALESCE(last_order,0)+1;
 IF last_at IS NOT NULL AND NEW.occurred_at<last_at THEN RAISE EXCEPTION 'Restriction events must be chronologically ordered.' USING ERRCODE='23514'; END IF;
 IF c.status<>'active' OR last_type='lifted' THEN RAISE EXCEPTION 'A lifted restriction is final; open a new case to restrict again.' USING ERRCODE='23514'; END IF;
 IF NOT EXISTS(SELECT 1 FROM accounts a WHERE a.id=NEW.actor_account_id AND a.status='active') THEN
  RAISE EXCEPTION 'Restriction actor must be an active account.' USING ERRCODE='23514'; END IF;
 IF NEW.private_basis IS NOT NULL AND length(btrim(NEW.private_basis))>=20 AND position(lower(btrim(NEW.private_basis)) in lower(NEW.public_notice))>0 THEN
  RAISE EXCEPTION 'The public notice must not repeat the private basis.' USING ERRCODE='23514'; END IF;
 IF NEW.event_type='opened' THEN
  IF last_type IS NOT NULL OR NEW.actor_account_id<>c.opened_by_account_id OR NEW.independent_review THEN
   RAISE EXCEPTION 'The opened event is the first event and belongs to the opener.' USING ERRCODE='23514'; END IF;
 ELSIF NEW.event_type='appealed' THEN
  IF last_type NOT IN ('opened','upheld') THEN RAISE EXCEPTION 'An appeal is already pending.' USING ERRCODE='23514'; END IF;
  IF NEW.independent_review OR NOT EXISTS(SELECT 1 FROM public.pde_restriction_target_owner_accounts(c.target_kind,c.target_id) o WHERE o=NEW.actor_account_id) THEN
   RAISE EXCEPTION 'Only the contributor whose item is restricted may appeal.' USING ERRCODE='23514'; END IF;
 ELSE
  IF NEW.event_type='upheld' AND last_type<>'appealed' THEN RAISE EXCEPTION 'Only a pending appeal can be upheld.' USING ERRCODE='23514'; END IF;
  IF public.pde_account_participates_in_debate(NEW.actor_account_id,c.debate_id) THEN
   RAISE EXCEPTION 'A debate participant or campaign member cannot decide a restriction in that debate.' USING ERRCODE='23514'; END IF;
  IF NEW.independent_review IS DISTINCT FROM (NEW.actor_account_id<>c.opened_by_account_id) THEN
   RAISE EXCEPTION 'independent_review must record whether the decider differs from the opener.' USING ERRCODE='23514'; END IF;
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER pde_restriction_event_guard BEFORE INSERT ON restriction_events
 FOR EACH ROW EXECUTE FUNCTION public.pde_guard_restriction_event();
CREATE TRIGGER pde_restriction_events_immutable BEFORE UPDATE OR DELETE ON restriction_events
 FOR EACH ROW EXECUTE FUNCTION public.pde_block_any_mutation();

-- Commit-time consistency: every case has its opened event, and every lifted
-- event is reflected in the case status.
CREATE OR REPLACE FUNCTION public.pde_check_restriction_consistency() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_TABLE_NAME='restriction_cases' THEN
  IF NOT EXISTS(SELECT 1 FROM restriction_events e WHERE e.case_id=NEW.id AND e.event_type='opened') THEN
   RAISE EXCEPTION 'A restriction case requires its opened event.' USING ERRCODE='23514'; END IF;
 ELSIF NEW.event_type='lifted' AND NOT EXISTS(SELECT 1 FROM restriction_cases rc WHERE rc.id=NEW.case_id AND rc.status='lifted') THEN
  RAISE EXCEPTION 'A lifted event requires the case status to be lifted.' USING ERRCODE='23514';
 END IF;
 RETURN NULL;
END $$;
CREATE CONSTRAINT TRIGGER pde_restriction_case_opened AFTER INSERT ON restriction_cases
 DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION public.pde_check_restriction_consistency();
CREATE CONSTRAINT TRIGGER pde_restriction_lift_consistent AFTER INSERT ON restriction_events
 DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION public.pde_check_restriction_consistency();
