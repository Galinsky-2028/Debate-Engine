-- Plan section 5 / docs/INVITATIONS.md: a direct invitation's response clock becomes a durable reply obligation the
-- moment a provider first accepts (or a webhook destination confirms) the invitation, if the debate has a reply window.
-- The invited candidate has no branch yet, so the obligation reuses reply_obligations with branch_id NULL, tied to
-- exactly one invitation and to the debate's opening as its source. Everything that already works on reply_obligations
-- (outage extensions, the deadline worker, overdue events, notices, the public ledger, the candidate inbox) applies.
ALTER TABLE reply_obligations ALTER COLUMN branch_id DROP NOT NULL;
ALTER TABLE reply_obligations ADD COLUMN IF NOT EXISTS invitation_id uuid REFERENCES debate_invitations(id);
ALTER TABLE reply_obligations ADD CONSTRAINT reply_obligations_branch_or_invitation_check
 CHECK ((invitation_id IS NULL AND branch_id IS NOT NULL) OR (invitation_id IS NOT NULL AND branch_id IS NULL AND obligation_type='reply'));
CREATE UNIQUE INDEX IF NOT EXISTS reply_obligations_one_per_invitation ON reply_obligations(invitation_id) WHERE invitation_id IS NOT NULL;

-- Defense in depth: an invitation clock must match its invitation, start no earlier than the debate publication and
-- the earliest provider evidence, and last exactly the debate's reply window. No evidence, no clock.
CREATE OR REPLACE FUNCTION public.pde_guard_invitation_obligation() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE evidence timestamptz;
BEGIN
 IF NEW.invitation_id IS NULL THEN RETURN NEW; END IF;
 SELECT min(o.accepted_at) INTO evidence FROM outgoing_actions o
  WHERE o.action_type='invitation' AND o.subject_kind='invitation' AND o.subject_id=NEW.invitation_id
   AND o.state IN ('accepted','delivered') AND o.accepted_at IS NOT NULL;
 IF evidence IS NULL OR NOT EXISTS(
   SELECT 1 FROM debate_invitations i JOIN debates d ON d.id=i.debate_id AND d.status='published'
   JOIN submissions s ON s.debate_id=d.id AND s.kind='opening'
   WHERE i.id=NEW.invitation_id AND i.debate_id=NEW.debate_id AND i.invited_candidacy_id=NEW.obligated_candidacy_id
    AND s.id=NEW.source_submission_id AND d.reply_window_hours IS NOT NULL
    AND NEW.opened_at=GREATEST(d.published_at,evidence)
    AND NEW.due_at=NEW.opened_at+d.reply_window_hours*interval '1 hour') THEN
  RAISE EXCEPTION 'An invitation response clock needs provider evidence and must match the invitation and the published reply window.' USING ERRCODE='23514';
 END IF;
 RETURN NEW;
END; $$;
DROP TRIGGER IF EXISTS pde_invitation_obligation_guard ON reply_obligations;
CREATE TRIGGER pde_invitation_obligation_guard BEFORE INSERT ON reply_obligations
 FOR EACH ROW EXECUTE FUNCTION public.pde_guard_invitation_obligation();

-- Open the clock once (idempotent) and enqueue its deadline job with the same key format as lib/server/obligations.ts
-- (obligation:<id>:deadline:<ISO due>). The first check runs 24 h before the deadline when the window exceeds 48 h.
-- No clock when the debate has no reply window or the invitee already published a contribution in the debate.
CREATE OR REPLACE FUNCTION public.pde_open_invitation_obligation(target_invitation uuid) RETURNS uuid
LANGUAGE plpgsql AS $$
DECLARE inv record; evidence timestamptz; v_opened timestamptz; v_due timestamptz; v_id uuid; v_iso text;
BEGIN
 SELECT i.id,i.debate_id,i.invited_candidacy_id,d.published_at,d.reply_window_hours,s.id AS opening_id
  INTO inv FROM debate_invitations i JOIN debates d ON d.id=i.debate_id AND d.status='published'
  JOIN submissions s ON s.debate_id=d.id AND s.kind='opening' WHERE i.id=target_invitation;
 IF NOT FOUND OR inv.reply_window_hours IS NULL THEN RETURN NULL; END IF;
 SELECT min(o.accepted_at) INTO evidence FROM outgoing_actions o
  WHERE o.action_type='invitation' AND o.subject_kind='invitation' AND o.subject_id=target_invitation
   AND o.state IN ('accepted','delivered') AND o.accepted_at IS NOT NULL;
 IF evidence IS NULL THEN RETURN NULL; END IF;
 IF EXISTS(SELECT 1 FROM submissions x WHERE x.debate_id=inv.debate_id AND x.candidacy_id=inv.invited_candidacy_id AND x.published_at IS NOT NULL) THEN
  RETURN NULL;
 END IF;
 v_opened:=GREATEST(inv.published_at,evidence);
 v_due:=v_opened+inv.reply_window_hours*interval '1 hour';
 INSERT INTO reply_obligations(debate_id,branch_id,source_submission_id,obligated_candidacy_id,obligation_type,opened_at,due_at,invitation_id)
 VALUES(inv.debate_id,NULL,inv.opening_id,inv.invited_candidacy_id,'reply',v_opened,v_due,inv.id)
 ON CONFLICT (invitation_id) WHERE invitation_id IS NOT NULL DO NOTHING RETURNING id INTO v_id;
 IF v_id IS NULL THEN RETURN NULL; END IF;
 v_iso:=to_char(v_due AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"');
 INSERT INTO durable_jobs(job_type,dedupe_key,arguments,available_at)
 VALUES('obligation_deadline','obligation:'||v_id||':deadline:'||v_iso,jsonb_build_object('obligationId',v_id,'effectiveDueAt',v_iso),
  CASE WHEN v_due-v_opened>interval '48 hours' THEN v_due-interval '24 hours' ELSE v_due END)
 ON CONFLICT (job_type,dedupe_key) DO NOTHING;
 INSERT INTO publication_events(debate_id,kind,object_id,payload)
 VALUES(inv.debate_id,'invitation_response_clock_opened',inv.id,jsonb_build_object(
  'obligationId',v_id,'invitedCandidacyId',inv.invited_candidacy_id,'openedAt',v_opened,'responseDueAt',v_due));
 RETURN v_id;
END; $$;

-- Provider evidence is recorded by the outbox processor's lease-checked UPDATE. Opening the clock happens in that same
-- statement. A failure here must never undo the truthful delivery record (which would cause a re-send), so it is
-- reported as a warning and the clock can be opened again by a later evidence row or pde_open_invitation_obligation().
CREATE OR REPLACE FUNCTION public.pde_invitation_evidence_opens_clock() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 BEGIN
  PERFORM public.pde_open_invitation_obligation(NEW.subject_id);
 EXCEPTION WHEN OTHERS THEN
  RAISE WARNING 'Invitation response clock was not opened for %: %', NEW.subject_id, SQLERRM;
 END;
 RETURN NULL;
END; $$;
DROP TRIGGER IF EXISTS pde_invitation_evidence_clock ON outgoing_actions;
CREATE TRIGGER pde_invitation_evidence_clock AFTER INSERT OR UPDATE OF accepted_at,state ON outgoing_actions
 FOR EACH ROW WHEN (NEW.action_type='invitation' AND NEW.subject_kind='invitation' AND NEW.accepted_at IS NOT NULL AND NEW.state IN ('accepted','delivered'))
 EXECUTE FUNCTION public.pde_invitation_evidence_opens_clock();

-- The invited candidate's first published contribution in the debate fulfils the clock at its publication time
-- (a response published before the clock opened is recorded as received when it opened, i.e. on time).
CREATE OR REPLACE FUNCTION public.pde_fulfil_invitation_obligation() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 UPDATE reply_obligations ro SET received_at=GREATEST(NEW.published_at,ro.opened_at),processed_at=GREATEST(NEW.published_at,ro.opened_at)
 WHERE ro.invitation_id IS NOT NULL AND ro.debate_id=NEW.debate_id AND ro.obligated_candidacy_id=NEW.candidacy_id AND ro.received_at IS NULL
  AND NOT EXISTS(SELECT 1 FROM obligation_supersessions s WHERE s.obligation_id=ro.id);
 RETURN NULL;
END; $$;
DROP TRIGGER IF EXISTS pde_invitation_obligation_fulfilled ON submissions;
CREATE TRIGGER pde_invitation_obligation_fulfilled AFTER INSERT OR UPDATE OF published_at ON submissions
 FOR EACH ROW WHEN (NEW.published_at IS NOT NULL)
 EXECUTE FUNCTION public.pde_fulfil_invitation_obligation();
