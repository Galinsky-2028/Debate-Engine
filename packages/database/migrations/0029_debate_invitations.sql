-- PDE-05 / plan section 5: direct invitations. A row is a drafted invitation; whether it was SENT is decided
-- only by outbox provider evidence (outgoing_actions.accepted_at/delivered_at), never by this row.
CREATE TABLE IF NOT EXISTS debate_invitations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  debate_id uuid NOT NULL REFERENCES debates(id),
  invited_candidacy_id uuid NOT NULL REFERENCES candidacies(id),
  invited_by_candidacy_id uuid NOT NULL REFERENCES candidacies(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (debate_id, invited_candidacy_id),
  CHECK (invited_candidacy_id <> invited_by_candidacy_id)
);
CREATE INDEX IF NOT EXISTS debate_invitations_debate_idx ON debate_invitations(debate_id, created_at);

CREATE OR REPLACE FUNCTION public.pde_debate_invitation_integrity() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM debates d
    JOIN candidacies invited ON invited.id=NEW.invited_candidacy_id
    WHERE d.id=NEW.debate_id AND d.status='published' AND d.originator_candidacy_id=NEW.invited_by_candidacy_id
      AND invited.election_id=d.election_id AND invited.verification_status='verified'
  ) THEN
    RAISE EXCEPTION 'Only the originator of a published debate may invite a verified candidacy in the same election.';
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS pde_debate_invitation_integrity ON debate_invitations;
CREATE TRIGGER pde_debate_invitation_integrity BEFORE INSERT ON debate_invitations
  FOR EACH ROW EXECUTE FUNCTION public.pde_debate_invitation_integrity();
DROP TRIGGER IF EXISTS pde_debate_invitations_immutable ON debate_invitations;
CREATE TRIGGER pde_debate_invitations_immutable BEFORE UPDATE OR DELETE ON debate_invitations
  FOR EACH ROW EXECUTE FUNCTION public.pde_block_any_mutation();

ALTER TABLE outgoing_actions ADD CONSTRAINT outgoing_actions_subject_kind_check
  CHECK (subject_kind IS NULL OR subject_kind IN ('obligation','invitation','derivative_artifact','policy_version','delivery_destination'));
