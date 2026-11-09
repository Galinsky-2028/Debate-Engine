-- PDE-13: preserve published qualifying exchanges when later opinions change.
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
      response.format_issues<>'[]'::jsonb OR reply.format_issues<>'[]'::jsonb THEN
      RAISE EXCEPTION 'Only complete reciprocal published exchanges may extend a sequence' USING ERRCODE='23514';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM questions WHERE submission_id=response.id) OR EXISTS (
      SELECT 1 FROM questions q
      WHERE q.submission_id IN (predecessor,response.id) AND (
        NOT EXISTS (SELECT 1 FROM answers a WHERE a.question_id=q.id
          AND a.submission_id=CASE WHEN q.submission_id=predecessor THEN response.id ELSE reply.id END)
        OR (SELECT a.decision FROM assessments a WHERE a.question_id=q.id
          AND a.answer_submission_id=CASE WHEN q.submission_id=predecessor THEN response.id ELSE reply.id END
          AND a.reviewer_candidacy_id=q.asked_by_candidacy_id
          ORDER BY a.created_at DESC,a.id DESC LIMIT 1) IS DISTINCT FROM 'answered')) THEN
      RAISE EXCEPTION 'Both questioners must accept the mapped reciprocal answers' USING ERRCODE='23514';
    END IF;
    predecessor:=reply.id;
  END LOOP;
  IF EXISTS (SELECT 1 FROM submissions s WHERE s.id=ANY(NEW.submission_ids)
    AND s.modality<>'writing' AND NOT EXISTS (SELECT 1 FROM media_permissions p
      WHERE p.media_asset_id=s.media_asset_id AND p.candidate_id=s.candidacy_id AND p.permission='sequence')) THEN
    RAISE EXCEPTION 'Every media original needs its owner sequence permission' USING ERRCODE='23514';
  END IF;
  NEW.manifest_sha256:=encode(sha256(convert_to(array_to_string(NEW.submission_ids, ','), 'UTF8')), 'hex');
  RETURN NEW;
END $$;
CREATE TRIGGER pde_sequence_manifest_validate BEFORE INSERT ON qualifying_sequence_manifests
  FOR EACH ROW EXECUTE FUNCTION pde_validate_sequence_manifest();
CREATE TRIGGER pde_sequence_manifest_immutable BEFORE UPDATE OR DELETE ON qualifying_sequence_manifests
  FOR EACH ROW EXECUTE FUNCTION pde_block_any_mutation();
