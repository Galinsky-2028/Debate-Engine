-- Plan sections 5, 7 and 8 (obligation dimension "superseded by recorded agreement").
-- When both branch participants CURRENTLY endorse the same FULL-scope policy version, every still-open review/reply
-- obligation on that branch is closed by the agreement. The closure is a separate append-only fact: reply_obligations
-- rows are never deleted, a received obligation is never marked, and a later withdrawal of endorsement does not
-- reopen anything retroactively (new contributions open new obligations normally).
CREATE TABLE IF NOT EXISTS obligation_supersessions (
 obligation_id uuid PRIMARY KEY REFERENCES reply_obligations(id),
 policy_version_id uuid NOT NULL REFERENCES policy_versions(id),
 superseded_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS obligation_supersessions_policy_idx ON obligation_supersessions(policy_version_id);

-- True only when both participants' LATEST endorsement event for this version is 'accept' and the version is 'full'.
-- A joint 'partial' agreement does not resolve the debate and never supersedes obligations.
CREATE OR REPLACE FUNCTION public.pde_policy_jointly_endorsed_full(version uuid) RETURNS boolean
LANGUAGE sql STABLE AS $$
 SELECT p.scope='full'
  AND (SELECT e.action FROM policy_endorsement_events e WHERE e.policy_version_id=p.id AND e.candidacy_id=d.originator_candidacy_id ORDER BY e.event_order DESC LIMIT 1)='accept'
  AND (SELECT e.action FROM policy_endorsement_events e WHERE e.policy_version_id=p.id AND e.candidacy_id=b.responder_candidacy_id ORDER BY e.event_order DESC LIMIT 1)='accept'
 FROM policy_versions p JOIN debate_branches b ON b.id=p.branch_id JOIN debates d ON d.id=b.debate_id
 WHERE p.id=version
$$;

CREATE OR REPLACE FUNCTION public.pde_guard_obligation_supersession() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF NOT EXISTS(
   SELECT 1 FROM reply_obligations ro JOIN policy_versions p ON p.id=NEW.policy_version_id
   WHERE ro.id=NEW.obligation_id AND ro.received_at IS NULL AND ro.branch_id IS NOT NULL AND ro.branch_id=p.branch_id) THEN
  RAISE EXCEPTION 'Only an open obligation on the agreement''s own branch can be superseded.' USING ERRCODE='23514';
 END IF;
 IF NOT COALESCE(public.pde_policy_jointly_endorsed_full(NEW.policy_version_id),false) THEN
  RAISE EXCEPTION 'Only a current joint full-scope agreement supersedes obligations.' USING ERRCODE='23514';
 END IF;
 NEW.superseded_at:=now(); -- never backdated
 RETURN NEW;
END; $$;
DROP TRIGGER IF EXISTS pde_obligation_supersession_guard ON obligation_supersessions;
CREATE TRIGGER pde_obligation_supersession_guard BEFORE INSERT ON obligation_supersessions
 FOR EACH ROW EXECUTE FUNCTION public.pde_guard_obligation_supersession();
DROP TRIGGER IF EXISTS pde_obligation_supersessions_immutable ON obligation_supersessions;
CREATE TRIGGER pde_obligation_supersessions_immutable BEFORE UPDATE OR DELETE ON obligation_supersessions
 FOR EACH ROW EXECUTE FUNCTION public.pde_block_any_mutation();

-- A superseded obligation stays closed: a later contribution never re-labels it as fulfilled.
CREATE OR REPLACE FUNCTION public.pde_guard_superseded_obligation() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF OLD.received_at IS NULL AND NEW.received_at IS NOT NULL
   AND EXISTS(SELECT 1 FROM obligation_supersessions s WHERE s.obligation_id=OLD.id) THEN
  RAISE EXCEPTION 'This obligation was closed by the candidates'' recorded agreement.' USING ERRCODE='23514';
 END IF;
 RETURN NEW;
END; $$;
DROP TRIGGER IF EXISTS pde_reply_obligation_superseded ON reply_obligations;
CREATE TRIGGER pde_reply_obligation_superseded BEFORE UPDATE ON reply_obligations
 FOR EACH ROW EXECUTE FUNCTION public.pde_guard_superseded_obligation();

-- Called in the endorsement transaction. Idempotent: a repeated call supersedes nothing new and publishes nothing.
CREATE OR REPLACE FUNCTION public.pde_supersede_obligations_by_agreement(target_version uuid) RETURNS integer
LANGUAGE plpgsql AS $$
DECLARE v_branch uuid; v_debate uuid; superseded integer;
BEGIN
 IF NOT COALESCE(public.pde_policy_jointly_endorsed_full(target_version),false) THEN RETURN 0; END IF;
 SELECT p.branch_id,b.debate_id INTO v_branch,v_debate FROM policy_versions p JOIN debate_branches b ON b.id=p.branch_id WHERE p.id=target_version;
 PERFORM 1 FROM reply_obligations ro WHERE ro.branch_id=v_branch AND ro.received_at IS NULL FOR UPDATE;
 WITH closed AS (
  INSERT INTO obligation_supersessions(obligation_id,policy_version_id)
  SELECT ro.id,target_version FROM reply_obligations ro
  WHERE ro.branch_id=v_branch AND ro.received_at IS NULL
   AND NOT EXISTS(SELECT 1 FROM obligation_supersessions s WHERE s.obligation_id=ro.id)
  ON CONFLICT (obligation_id) DO NOTHING RETURNING obligation_id)
 SELECT count(*)::integer INTO superseded FROM closed;
 IF superseded>0 THEN
  INSERT INTO publication_events(debate_id,branch_id,kind,object_id,payload)
  VALUES(v_debate,v_branch,'obligations_superseded_by_agreement',target_version,jsonb_build_object(
   'policyVersionId',target_version,'count',superseded,'label','Closed by the candidates'' recorded agreement'));
 END IF;
 RETURN superseded;
END; $$;
