-- PDE-06: mutual, exact-version branch rules. Original debate rules and old clocks stay immutable.
CREATE TABLE branch_rule_proposals (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 branch_id uuid NOT NULL REFERENCES debate_branches(id),
 proposed_by_candidacy_id uuid NOT NULL REFERENCES candidacies(id),
 base_revision integer NOT NULL CHECK(base_revision>0),
 max_response_seconds integer NOT NULL CHECK(max_response_seconds BETWEEN 1 AND 7200),
 reply_window_hours integer CHECK(reply_window_hours BETWEEN 1 AND 720),
 allowed_modalities text[] NOT NULL CHECK(cardinality(allowed_modalities) BETWEEN 1 AND 3
   AND allowed_modalities<@ARRAY['video','audio','writing']::text[] AND array_position(allowed_modalities,NULL) IS NULL),
 content_sha256 text NOT NULL CHECK(content_sha256 ~ '^[a-f0-9]{64}$'),
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 UNIQUE(id,content_sha256)
);
CREATE TABLE branch_rule_approvals (
 proposal_id uuid NOT NULL,
 content_sha256 text NOT NULL,
 candidacy_id uuid NOT NULL REFERENCES candidacies(id),
 approved_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 PRIMARY KEY(proposal_id,candidacy_id),
 FOREIGN KEY(proposal_id,content_sha256) REFERENCES branch_rule_proposals(id,content_sha256)
);
CREATE TABLE branch_rule_versions (
 branch_id uuid NOT NULL REFERENCES debate_branches(id),
 revision integer NOT NULL CHECK(revision>1),
 proposal_id uuid NOT NULL UNIQUE REFERENCES branch_rule_proposals(id),
 activated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 PRIMARY KEY(branch_id,revision)
);
CREATE FUNCTION pde_guard_branch_rule_change() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE target uuid; originator uuid; contender uuid; prior_revision integer; proposal branch_rule_proposals;
BEGIN
 IF TG_TABLE_NAME='branch_rule_proposals' THEN target:=NEW.branch_id;
 ELSE SELECT * INTO STRICT proposal FROM branch_rule_proposals WHERE id=NEW.proposal_id;target:=proposal.branch_id;
 END IF;
 SELECT d.originator_candidacy_id,b.responder_candidacy_id INTO originator,contender
  FROM debate_branches b JOIN debates d ON d.id=b.debate_id WHERE b.id=target AND d.status='published' FOR UPDATE OF b;
 IF originator IS NULL THEN RAISE EXCEPTION 'Published branch required' USING ERRCODE='23514';END IF;
 SELECT COALESCE(max(revision),1) INTO prior_revision FROM branch_rule_versions WHERE branch_id=target;
 IF TG_TABLE_NAME='branch_rule_proposals' THEN
  IF NEW.proposed_by_candidacy_id NOT IN(originator,contender) OR NEW.base_revision<>prior_revision OR
   cardinality(NEW.allowed_modalities)<>(SELECT count(DISTINCT m) FROM unnest(NEW.allowed_modalities) m) THEN
   RAISE EXCEPTION 'Rule proposal needs a participant, current base version and unique media' USING ERRCODE='23514';END IF;
 ELSIF TG_TABLE_NAME='branch_rule_approvals' THEN
  IF NEW.candidacy_id NOT IN(originator,contender) OR proposal.base_revision<>prior_revision THEN
   RAISE EXCEPTION 'Only participants may approve current-base rule proposals' USING ERRCODE='23514';END IF;
 ELSE
  IF NEW.branch_id<>target OR NEW.revision<>prior_revision+1 OR proposal.base_revision<>prior_revision OR
    NOT EXISTS(SELECT 1 FROM branch_rule_approvals WHERE proposal_id=proposal.id AND candidacy_id=originator) OR
    NOT EXISTS(SELECT 1 FROM branch_rule_approvals WHERE proposal_id=proposal.id AND candidacy_id=contender) THEN
   RAISE EXCEPTION 'Rule activation requires both exact-version participant approvals' USING ERRCODE='23514';END IF;
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER pde_branch_rule_proposal_actor BEFORE INSERT ON branch_rule_proposals FOR EACH ROW EXECUTE FUNCTION pde_guard_branch_rule_change();
CREATE TRIGGER pde_branch_rule_approval_actor BEFORE INSERT ON branch_rule_approvals FOR EACH ROW EXECUTE FUNCTION pde_guard_branch_rule_change();
CREATE TRIGGER pde_branch_rule_activation BEFORE INSERT ON branch_rule_versions FOR EACH ROW EXECUTE FUNCTION pde_guard_branch_rule_change();
CREATE TRIGGER pde_branch_rule_proposal_immutable BEFORE UPDATE OR DELETE ON branch_rule_proposals FOR EACH ROW EXECUTE FUNCTION pde_block_any_mutation();
CREATE TRIGGER pde_branch_rule_approval_immutable BEFORE UPDATE OR DELETE ON branch_rule_approvals FOR EACH ROW EXECUTE FUNCTION pde_block_any_mutation();
CREATE TRIGGER pde_branch_rule_version_immutable BEFORE UPDATE OR DELETE ON branch_rule_versions FOR EACH ROW EXECUTE FUNCTION pde_block_any_mutation();

CREATE FUNCTION pde_guard_submission_rule_version() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE current_revision integer;
BEGIN
 IF NEW.branch_id IS NULL THEN current_revision:=1;
 ELSE
  PERFORM 1 FROM debate_branches WHERE id=NEW.branch_id FOR UPDATE;
  SELECT COALESCE(max(revision),1) INTO current_revision FROM branch_rule_versions WHERE branch_id=NEW.branch_id;
 END IF;
 IF NEW.rules_version<>current_revision THEN
  RAISE EXCEPTION 'New contributions must confirm the current branch rules' USING ERRCODE='23514';
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER pde_submission_current_rules BEFORE INSERT OR UPDATE OF rules_version ON submissions
 FOR EACH ROW EXECUTE FUNCTION pde_guard_submission_rule_version();
