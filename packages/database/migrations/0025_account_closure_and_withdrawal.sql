-- PDE-26: account closure and candidacy withdrawal.
-- Closure and withdrawal never rewrite historic attribution: published rows,
-- questions, assessments, agreements and candidacy snapshots stay public.

CREATE TABLE IF NOT EXISTS candidacy_status_events(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 candidacy_id uuid NOT NULL REFERENCES candidacies(id),
 event_type text NOT NULL CHECK (event_type IN ('withdrawn')),
 actor_account_id uuid NOT NULL REFERENCES accounts(id),
 public_statement text CHECK (public_statement IS NULL OR length(btrim(public_statement)) BETWEEN 1 AND 1000),
 occurred_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS candidacy_one_withdrawal ON candidacy_status_events(candidacy_id) WHERE event_type='withdrawn';

CREATE OR REPLACE FUNCTION public.pde_guard_candidacy_status_event() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF NOT EXISTS(SELECT 1 FROM candidacies c JOIN accounts a ON a.id=c.account_id
   WHERE c.id=NEW.candidacy_id AND c.account_id=NEW.actor_account_id AND a.status='active') THEN
  RAISE EXCEPTION 'Only the active account owning the candidacy may withdraw it.' USING ERRCODE='23514';
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER pde_candidacy_status_event_actor BEFORE INSERT ON candidacy_status_events
 FOR EACH ROW EXECUTE FUNCTION public.pde_guard_candidacy_status_event();
CREATE TRIGGER pde_candidacy_status_events_immutable BEFORE UPDATE OR DELETE ON candidacy_status_events
 FOR EACH ROW EXECUTE FUNCTION public.pde_block_any_mutation();

-- Closure is final and accounts referenced by public evidence are never deleted.
CREATE OR REPLACE FUNCTION public.pde_guard_account_status() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_OP='DELETE' THEN RAISE EXCEPTION 'Accounts are retained for attribution; close the account instead.' USING ERRCODE='55000'; END IF;
 IF OLD.status='closed' AND NEW.status<>'closed' THEN
  RAISE EXCEPTION 'A closed account cannot be reopened.' USING ERRCODE='55000';
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER pde_account_status_guard BEFORE UPDATE OR DELETE ON accounts
 FOR EACH ROW EXECUTE FUNCTION public.pde_guard_account_status();

-- Defense in depth: writes attributed to a candidacy (or account) require an
-- active account; 'publish' writes additionally require a non-withdrawn candidacy.
-- TG_ARGV[0]=column, TG_ARGV[1]='candidacy'|'account', TG_ARGV[2]='publish'|'any'.
CREATE OR REPLACE FUNCTION public.pde_guard_active_actor() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE ref uuid; acct_status text;
BEGIN
 ref:=(to_jsonb(NEW)->>TG_ARGV[0])::uuid;
 IF ref IS NULL THEN RETURN NEW; END IF;
 IF TG_ARGV[1]='account' THEN
  SELECT a.status INTO acct_status FROM accounts a WHERE a.id=ref;
 ELSE
  SELECT a.status INTO acct_status FROM candidacies c JOIN accounts a ON a.id=c.account_id WHERE c.id=ref;
 END IF;
 IF acct_status IS NOT NULL AND acct_status<>'active' THEN
  RAISE EXCEPTION 'A closed or suspended account cannot create new records (%).',TG_TABLE_NAME USING ERRCODE='23514';
 END IF;
 IF TG_ARGV[2]='publish' AND EXISTS(SELECT 1 FROM candidacy_status_events w WHERE w.candidacy_id=ref AND w.event_type='withdrawn') THEN
  RAISE EXCEPTION 'A withdrawn candidacy cannot start debates or publish new contributions (%).',TG_TABLE_NAME USING ERRCODE='23514';
 END IF;
 RETURN NEW;
END $$;

CREATE TRIGGER pde_active_actor BEFORE INSERT ON debates FOR EACH ROW EXECUTE FUNCTION public.pde_guard_active_actor('originator_candidacy_id','candidacy','publish');
CREATE TRIGGER pde_active_actor BEFORE INSERT ON submissions FOR EACH ROW EXECUTE FUNCTION public.pde_guard_active_actor('candidacy_id','candidacy','publish');
CREATE TRIGGER pde_active_actor BEFORE INSERT ON debate_branches FOR EACH ROW EXECUTE FUNCTION public.pde_guard_active_actor('responder_candidacy_id','candidacy','publish');
CREATE TRIGGER pde_active_actor BEFORE INSERT ON questions FOR EACH ROW EXECUTE FUNCTION public.pde_guard_active_actor('asked_by_candidacy_id','candidacy','publish');
CREATE TRIGGER pde_active_actor BEFORE INSERT ON submission_corrections FOR EACH ROW EXECUTE FUNCTION public.pde_guard_active_actor('candidacy_id','candidacy','any');
CREATE TRIGGER pde_active_actor BEFORE INSERT ON submission_documents FOR EACH ROW EXECUTE FUNCTION public.pde_guard_active_actor('uploaded_by_candidacy_id','candidacy','any');
CREATE TRIGGER pde_active_actor BEFORE INSERT ON assessments FOR EACH ROW EXECUTE FUNCTION public.pde_guard_active_actor('reviewer_candidacy_id','candidacy','any');
CREATE TRIGGER pde_active_actor BEFORE INSERT ON assessment_objections FOR EACH ROW EXECUTE FUNCTION public.pde_guard_active_actor('objecting_candidacy_id','candidacy','any');
CREATE TRIGGER pde_active_actor BEFORE INSERT ON policy_versions FOR EACH ROW EXECUTE FUNCTION public.pde_guard_active_actor('proposed_by_candidacy_id','candidacy','any');
CREATE TRIGGER pde_active_actor BEFORE INSERT ON policy_acceptances FOR EACH ROW EXECUTE FUNCTION public.pde_guard_active_actor('candidacy_id','candidacy','any');
CREATE TRIGGER pde_active_actor BEFORE INSERT ON policy_endorsement_events FOR EACH ROW EXECUTE FUNCTION public.pde_guard_active_actor('candidacy_id','candidacy','any');
CREATE TRIGGER pde_active_actor BEFORE INSERT ON media_captions FOR EACH ROW EXECUTE FUNCTION public.pde_guard_active_actor('published_by_candidacy_id','candidacy','any');
CREATE TRIGGER pde_active_actor BEFORE INSERT ON derivative_approvals FOR EACH ROW EXECUTE FUNCTION public.pde_guard_active_actor('candidacy_id','candidacy','any');
CREATE TRIGGER pde_active_actor BEFORE INSERT ON media_assets FOR EACH ROW EXECUTE FUNCTION public.pde_guard_active_actor('owner_candidacy_id','candidacy','any');
CREATE TRIGGER pde_active_actor BEFORE INSERT ON media_upload_sessions FOR EACH ROW EXECUTE FUNCTION public.pde_guard_active_actor('owner_candidacy_id','candidacy','any');
CREATE TRIGGER pde_active_actor BEFORE INSERT ON media_permissions FOR EACH ROW EXECUTE FUNCTION public.pde_guard_active_actor('candidate_id','candidacy','any');
CREATE TRIGGER pde_active_actor BEFORE INSERT ON candidacies FOR EACH ROW EXECUTE FUNCTION public.pde_guard_active_actor('account_id','account','any');
CREATE TRIGGER pde_active_actor BEFORE INSERT ON campaign_memberships FOR EACH ROW EXECUTE FUNCTION public.pde_guard_active_actor('account_id','account','any');
CREATE TRIGGER pde_active_actor BEFORE INSERT ON private_submission_drafts FOR EACH ROW EXECUTE FUNCTION public.pde_guard_active_actor('owner_account_id','account','any');
