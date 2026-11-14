-- PDE-13: versioned, append-only qualifying sequence manifests per branch.
-- A manifest revision is materialized in the same transaction as the publication or
-- assessment that makes a new completed exchange unit qualify. Later reassessments
-- never delete or rewrite an earlier revision (plan section 7).
CREATE TABLE qualifying_sequence_manifests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  branch_id uuid NOT NULL REFERENCES debate_branches(id),
  revision integer NOT NULL CHECK (revision > 0),
  submission_ids uuid[] NOT NULL CHECK (
    cardinality(submission_ids) >= 3 AND cardinality(submission_ids) % 2 = 1
    AND array_position(submission_ids, NULL) IS NULL),
  manifest_sha256 text NOT NULL CHECK (manifest_sha256 ~ '^[0-9a-f]{64}$'),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  UNIQUE (branch_id, revision)
);

-- The questioner's latest decision. Migration 0022 replaces only this helper to use insertion order.
CREATE FUNCTION pde_latest_assessment_decision(question uuid, answer_submission uuid, reviewer uuid)
RETURNS text LANGUAGE sql STABLE AS $$
  SELECT a.decision FROM assessments a
  WHERE a.question_id=question AND a.answer_submission_id=answer_submission AND a.reviewer_candidacy_id=reviewer
  ORDER BY a.created_at DESC,a.id DESC LIMIT 1
$$;

CREATE FUNCTION pde_validate_sequence_manifest() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  branch debate_branches;
  originator uuid;
  previous qualifying_sequence_manifests;
  opening submissions;
  response submissions;
  reply submissions;
  predecessor uuid;
  start_position integer;
  i integer;
BEGIN
  SELECT * INTO STRICT branch FROM debate_branches WHERE id=NEW.branch_id FOR UPDATE;
  SELECT originator_candidacy_id INTO originator FROM debates
    WHERE id=branch.debate_id AND status='published';
  IF originator IS NULL THEN
    RAISE EXCEPTION 'A sequence requires a published debate' USING ERRCODE='23514';
  END IF;
  SELECT * INTO previous FROM qualifying_sequence_manifests WHERE branch_id=NEW.branch_id
    ORDER BY revision DESC LIMIT 1;
  IF NEW.revision<>COALESCE(previous.revision,0)+1 OR
    (previous.id IS NOT NULL AND
      (cardinality(NEW.submission_ids)<=cardinality(previous.submission_ids) OR
       NEW.submission_ids[1:cardinality(previous.submission_ids)]<>previous.submission_ids)) THEN
    RAISE EXCEPTION 'A sequence revision may only extend its published predecessor' USING ERRCODE='23514';
  END IF;
  SELECT * INTO opening FROM submissions WHERE id=NEW.submission_ids[1];
  IF opening.id IS NULL OR opening.kind<>'opening' OR opening.debate_id<>branch.debate_id
    OR opening.candidacy_id<>originator OR opening.published_at IS NULL THEN
    RAISE EXCEPTION 'A sequence must begin with the published opening' USING ERRCODE='23514';
  END IF;
  IF cardinality(NEW.submission_ids)<>(SELECT count(DISTINCT id) FROM unnest(NEW.submission_ids) id) THEN
    RAISE EXCEPTION 'A sequence cannot repeat contributions' USING ERRCODE='23514';
  END IF;
  -- Earlier revisions were validated when published; only the appended exchanges are checked
  -- against current assessments, so a later reversal cannot invalidate a published prefix.
  start_position:=COALESCE(cardinality(previous.submission_ids),1)+1;
  predecessor:=NEW.submission_ids[start_position-1];
  FOR i IN start_position..cardinality(NEW.submission_ids) BY 2 LOOP
    SELECT * INTO response FROM submissions WHERE id=NEW.submission_ids[i];
    SELECT * INTO reply FROM submissions WHERE id=NEW.submission_ids[i+1];
    IF response.id IS NULL OR reply.id IS NULL OR
      response.branch_id IS DISTINCT FROM branch.id OR reply.branch_id IS DISTINCT FROM branch.id OR
      response.candidacy_id<>branch.responder_candidacy_id OR reply.candidacy_id<>originator OR
      response.parent_submission_id IS DISTINCT FROM predecessor OR reply.parent_submission_id IS DISTINCT FROM response.id OR
      response.published_at IS NULL OR reply.published_at IS NULL OR
      COALESCE(response.format_issues,'[]'::jsonb)<>'[]'::jsonb OR COALESCE(reply.format_issues,'[]'::jsonb)<>'[]'::jsonb THEN
      RAISE EXCEPTION 'Only complete reciprocal published exchanges may extend a sequence' USING ERRCODE='23514';
    END IF;
    -- A contender's closing turn may pose no question (the first response's question
    -- requirement is already a recorded format issue); every posed question must be
    -- answered in the next contribution and accepted by its questioner.
    IF EXISTS (
      SELECT 1 FROM questions q
      WHERE q.submission_id IN (predecessor,response.id) AND (
        NOT EXISTS (SELECT 1 FROM answers a WHERE a.question_id=q.id
          AND a.submission_id=CASE WHEN q.submission_id=predecessor THEN response.id ELSE reply.id END)
        OR pde_latest_assessment_decision(q.id,
          CASE WHEN q.submission_id=predecessor THEN response.id ELSE reply.id END,
          q.asked_by_candidacy_id) IS DISTINCT FROM 'answered')) THEN
      RAISE EXCEPTION 'Both questioners must accept the mapped reciprocal answers' USING ERRCODE='23514';
    END IF;
    predecessor:=reply.id;
  END LOOP;
  IF EXISTS (SELECT 1 FROM submissions s WHERE s.id=ANY(NEW.submission_ids)
    AND s.modality<>'writing' AND NOT EXISTS (SELECT 1 FROM media_permissions p
      WHERE p.media_asset_id=s.media_asset_id AND p.candidate_id=s.candidacy_id AND p.permission='sequence')) THEN
    RAISE EXCEPTION 'Every media original needs its owner sequence permission' USING ERRCODE='23514';
  END IF;
  -- Integrity digest over the ordered UUIDs; computed here so a caller cannot supply it.
  NEW.manifest_sha256:=encode(sha256(convert_to(array_to_string(NEW.submission_ids, ','), 'UTF8')), 'hex');
  RETURN NEW;
END $$;
CREATE TRIGGER pde_sequence_manifest_validate BEFORE INSERT ON qualifying_sequence_manifests
  FOR EACH ROW EXECUTE FUNCTION pde_validate_sequence_manifest();
CREATE TRIGGER pde_sequence_manifest_immutable BEFORE UPDATE OR DELETE ON qualifying_sequence_manifests
  FOR EACH ROW EXECUTE FUNCTION pde_block_any_mutation();
CREATE INDEX qualifying_sequence_manifests_branch_idx ON qualifying_sequence_manifests(branch_id, revision DESC);
