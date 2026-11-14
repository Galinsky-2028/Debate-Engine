-- Equal timestamps (one transaction) and UUID lexical order must not reorder a questioner's decisions.
-- Existing rows keep NULL and the earlier timestamp/UUID ordering; new decisions use insertion order
-- and always sort after legacy rows.
ALTER TABLE assessments ADD COLUMN event_order bigint;
CREATE SEQUENCE assessment_event_order_seq OWNED BY assessments.event_order;
ALTER TABLE assessments ALTER COLUMN event_order SET DEFAULT nextval('assessment_event_order_seq');
CREATE UNIQUE INDEX assessments_event_order_unique ON assessments(event_order);
CREATE INDEX assessments_latest_event_idx
  ON assessments(question_id,answer_submission_id,event_order DESC NULLS LAST,created_at DESC,id DESC);

CREATE OR REPLACE FUNCTION pde_latest_assessment_decision(question uuid, answer_submission uuid, reviewer uuid)
RETURNS text LANGUAGE sql STABLE AS $$
  SELECT a.decision FROM assessments a
  WHERE a.question_id=question AND a.answer_submission_id=answer_submission AND a.reviewer_candidacy_id=reviewer
  ORDER BY a.event_order DESC NULLS LAST,a.created_at DESC,a.id DESC LIMIT 1
$$;
