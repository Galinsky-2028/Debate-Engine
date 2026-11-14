-- PDE-19: scoped policy proposals. Every new field is part of the immutable
-- version (and of its content digest, computed by packages/domain/policy.ts).
-- Defaults keep every existing row a legacy full-scope proposal whose digest is unchanged.
ALTER TABLE policy_versions
 ADD COLUMN scope text NOT NULL DEFAULT 'full' CHECK (scope IN ('full','partial')),
 ADD COLUMN addressed_question_ids uuid[] NOT NULL DEFAULT '{}'::uuid[],
 ADD COLUMN changes_summary text NOT NULL DEFAULT '' CHECK (length(changes_summary)<=10000),
 ADD COLUMN remaining_disagreements text NOT NULL DEFAULT '' CHECK (length(remaining_disagreements)<=10000),
 ADD COLUMN attachment_document_ids uuid[] NOT NULL DEFAULT '{}'::uuid[],
 ADD CONSTRAINT policy_versions_partial_states_disagreements
  CHECK (scope='full' OR length(btrim(remaining_disagreements))>0),
 ADD CONSTRAINT policy_versions_bounded_lists
  CHECK (cardinality(addressed_question_ids)<=50 AND cardinality(attachment_document_ids)<=20);

CREATE OR REPLACE FUNCTION public.pde_guard_policy_scope() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE branch_debate uuid;
BEGIN
 SELECT b.debate_id INTO branch_debate FROM debate_branches b WHERE b.id=NEW.branch_id;
 IF NEW.parent_version_id IS NOT NULL AND NOT EXISTS(
   SELECT 1 FROM policy_versions p WHERE p.id=NEW.parent_version_id AND p.branch_id=NEW.branch_id) THEN
  RAISE EXCEPTION 'A counterproposal must descend from a version in the same branch.' USING ERRCODE='23514';
 END IF;
 IF array_position(NEW.addressed_question_ids,NULL) IS NOT NULL
  OR array_position(NEW.attachment_document_ids,NULL) IS NOT NULL THEN
  RAISE EXCEPTION 'Policy scope lists cannot contain empty entries.' USING ERRCODE='23514';
 END IF;
 IF (SELECT count(DISTINCT x) FROM unnest(NEW.addressed_question_ids) x)<>cardinality(NEW.addressed_question_ids)
  OR (SELECT count(DISTINCT x) FROM unnest(NEW.attachment_document_ids) x)<>cardinality(NEW.attachment_document_ids) THEN
  RAISE EXCEPTION 'A question or attachment may be listed only once.' USING ERRCODE='23514';
 END IF;
 -- Addressed questions: published, in this debate, asked on this branch or in the opening.
 IF EXISTS(SELECT 1 FROM unnest(NEW.addressed_question_ids) wanted(id) WHERE NOT EXISTS(
   SELECT 1 FROM questions q JOIN submissions s ON s.id=q.submission_id
   WHERE q.id=wanted.id AND s.debate_id=branch_debate AND s.published_at IS NOT NULL
     AND (s.branch_id=NEW.branch_id OR s.kind='opening'))) THEN
  RAISE EXCEPTION 'Addressed questions must be published questions from this branch or the opening.' USING ERRCODE='23514';
 END IF;
 -- Attachments: already published supporting documents of the same debate.
 IF EXISTS(SELECT 1 FROM unnest(NEW.attachment_document_ids) wanted(id) WHERE NOT EXISTS(
   SELECT 1 FROM submission_documents x JOIN submissions s ON s.id=x.submission_id
   WHERE x.id=wanted.id AND s.debate_id=branch_debate AND s.published_at IS NOT NULL)) THEN
  RAISE EXCEPTION 'Policy attachments must be published supporting documents of this debate.' USING ERRCODE='23514';
 END IF;
 RETURN NEW;
END; $$;
CREATE TRIGGER pde_policy_scope BEFORE INSERT ON policy_versions
 FOR EACH ROW EXECUTE FUNCTION public.pde_guard_policy_scope();
