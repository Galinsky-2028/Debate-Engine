-- Equal timestamps and UUID lexical order must not reorder an author's decisions.
-- Existing ties retain the previous timestamp/ID ordering; new decisions use insertion order.
ALTER TABLE assessments ADD COLUMN event_order bigint;
CREATE SEQUENCE assessment_event_order_seq OWNED BY assessments.event_order;
ALTER TABLE assessments ALTER COLUMN event_order SET DEFAULT nextval('assessment_event_order_seq');
CREATE UNIQUE INDEX assessments_event_order_unique ON assessments(event_order);
CREATE INDEX assessments_latest_event ON assessments(question_id,answer_submission_id,event_order DESC NULLS LAST,created_at DESC,id DESC);

-- New sequence manifests use the same assessment ordering as the public projection.
-- PostgreSQL functions are stored as source; replace only the ordering in the new function.
DO $$
DECLARE definition text;
BEGIN
 SELECT pg_get_functiondef('pde_validate_sequence_manifest()'::regprocedure) INTO definition;
 IF strpos(definition,'ORDER BY a.created_at DESC,a.id DESC LIMIT 1')=0 THEN
   RAISE EXCEPTION 'Unexpected sequence validation function; refuse to change assessment ordering';
 END IF;
 definition:=replace(definition,'ORDER BY a.created_at DESC,a.id DESC LIMIT 1','ORDER BY a.event_order DESC NULLS LAST,a.created_at DESC,a.id DESC LIMIT 1');
 EXECUTE definition;
END $$;
