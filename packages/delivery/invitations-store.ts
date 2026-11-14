import type {PoolClient} from "pg";
import {projectInvitation} from "../domain/invitations.ts";

export type PublicInvitation = {id: string; invitedCandidacyId: string; invitedName: string; createdAt: string; state: string; label: string; sentAt: string | null; responseDueAt: string | null};

/**
 * Public projection: names, dates and neutral states only (never destination addresses or account identifiers).
 * "Sent" is derived solely from provider evidence on invitation outbox actions (accepted_at), never from the draft.
 * Once that evidence exists, the durable response clock (a reply obligation tied to the invitation) supplies the dates.
 */
export async function loadInvitationProjections(db: Pick<PoolClient, "query">, debateId: string): Promise<PublicInvitation[]> {
  const r = await db.query<{id: string; invited_candidacy_id: string; public_name: string; created_at: Date; published_at: Date; reply_window_hours: number | null; evidence_at: Date | null; responded_at: Date | null; now: Date; clock_opened_at: Date | null; clock_due_at: Date | null}>(
    `SELECT i.id,i.invited_candidacy_id,c.public_name,i.created_at,d.published_at,d.reply_window_hours,now() AS now,
      (SELECT min(o.accepted_at) FROM outgoing_actions o WHERE o.action_type='invitation' AND o.subject_kind='invitation' AND o.subject_id=i.id AND o.state IN ('accepted','delivered')) AS evidence_at,
      (SELECT min(s.published_at) FROM submissions s WHERE s.debate_id=i.debate_id AND s.candidacy_id=i.invited_candidacy_id AND s.published_at IS NOT NULL) AS responded_at,
      ro.opened_at AS clock_opened_at,
      ro.due_at+COALESCE((SELECT sum(oa.seconds) FROM obligation_outage_adjustments oa WHERE oa.obligation_id=ro.id),0)*interval '1 second' AS clock_due_at
     FROM debate_invitations i LEFT JOIN reply_obligations ro ON ro.invitation_id=i.id JOIN debates d ON d.id=i.debate_id AND d.status='published' JOIN candidacies c ON c.id=i.invited_candidacy_id
     WHERE i.debate_id=$1 ORDER BY i.created_at,i.id`, [debateId]);
  return r.rows.map(row => {
    const p = projectInvitation({
      debatePublishedAt: new Date(row.published_at).toISOString(),
      providerEvidenceAt: row.evidence_at ? new Date(row.evidence_at).toISOString() : null,
      replyWindowHours: row.reply_window_hours, respondedAt: row.responded_at ? new Date(row.responded_at).toISOString() : null,
      now: new Date(row.now).toISOString(),
      clock: row.clock_opened_at ? {openedAt: new Date(row.clock_opened_at).toISOString(), effectiveDueAt: row.clock_due_at ? new Date(row.clock_due_at).toISOString() : null} : null,
    });
    return {id: row.id, invitedCandidacyId: row.invited_candidacy_id, invitedName: row.public_name, createdAt: new Date(row.created_at).toISOString(),
      state: p.state, label: p.label, sentAt: p.sentAt, responseDueAt: p.responseDueAt};
  });
}
