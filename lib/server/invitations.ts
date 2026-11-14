import "server-only";
import {database, transaction} from "./db";
import {HttpError} from "./http";
import {enqueueInvitationDelivery} from "../../packages/delivery/outbox-store.ts";
import {loadInvitationProjections, type PublicInvitation} from "../../packages/delivery/invitations-store.ts";

/**
 * Plan section 5 invitations. The originator of a published debate may invite a verified candidacy in the same
 * election. Delivery uses only the invitee's own verified notification destinations; no arbitrary addresses.
 * Repeating the request is idempotent and only queues delivery to destinations that have not received it.
 */
export async function inviteCandidate(input: {debateId: string; candidacyId: string; invitedCandidacyId: string; authSubject: string}) {
  if (input.candidacyId === input.invitedCandidacyId) throw new HttpError(400, "You cannot invite yourself.");
  return transaction(async db => {
    const o = await db.query<{account_id: string; election_id: string}>(
      `SELECT a.id AS account_id,d.election_id FROM debates d JOIN candidacies c ON c.id=d.originator_candidacy_id AND c.id=$2 AND c.verification_status='verified'
       JOIN accounts a ON a.id=c.account_id WHERE d.id=$1 AND d.status='published' AND a.identity_provider='neon-auth' AND a.external_subject=$3`,
      [input.debateId, input.candidacyId, input.authSubject]);
    if (!o.rowCount) throw new HttpError(403, "Only the verified originator of a published debate may invite candidates.");
    const invited = await db.query("SELECT 1 FROM candidacies WHERE id=$1 AND election_id=$2 AND verification_status='verified'", [input.invitedCandidacyId, o.rows[0].election_id]);
    if (!invited.rowCount) throw new HttpError(409, "Only a verified candidacy in the same election can be invited.");
    const inserted = await db.query<{id: string}>(
      "INSERT INTO debate_invitations(debate_id,invited_candidacy_id,invited_by_candidacy_id) VALUES($1,$2,$3) ON CONFLICT(debate_id,invited_candidacy_id) DO NOTHING RETURNING id",
      [input.debateId, input.invitedCandidacyId, input.candidacyId]);
    let invitationId: string;
    if (inserted.rowCount) {
      invitationId = inserted.rows[0].id;
      await db.query("INSERT INTO publication_events(debate_id,actor_candidacy_id,kind,object_id,payload) VALUES($1,$2,'invitation_drafted',$3,$4::jsonb)",
        [input.debateId, input.candidacyId, invitationId, JSON.stringify({invitedCandidacyId: input.invitedCandidacyId})]);
      await db.query("INSERT INTO audit_events(actor_account_id,action,target_kind,target_id) VALUES($1,'invitation_drafted','debate_invitation',$2)", [o.rows[0].account_id, invitationId]);
    } else {
      invitationId = (await db.query<{id: string}>("SELECT id FROM debate_invitations WHERE debate_id=$1 AND invited_candidacy_id=$2", [input.debateId, input.invitedCandidacyId])).rows[0].id;
    }
    const queued = await enqueueInvitationDelivery(db, invitationId);
    const destinations = await db.query<{n: number}>(
      "SELECT count(*)::int AS n FROM delivery_destinations WHERE candidacy_id=$1 AND verified_at IS NOT NULL AND disabled_at IS NULL AND 'notifications'=ANY(purposes)", [input.invitedCandidacyId]);
    return {invitationId, created: Boolean(inserted.rowCount), queuedDeliveries: queued,
      status: destinations.rows[0].n === 0 ? "Invitation drafted — not sent: the invited candidate has no verified notification destination." : "Invitation drafted — delivery queued; it counts as sent only when a provider accepts it."};
  });
}

export type {PublicInvitation};
export function publicInvitations(debateId: string): Promise<PublicInvitation[]> { return loadInvitationProjections(database(), debateId); }

/** Verified same-election candidacies the originator could invite (public names only). */
export async function invitableCandidacies(debateId: string) {
  const r = await database().query<{id: string; public_name: string}>(
    `SELECT c.id,c.public_name FROM debates d JOIN candidacies c ON c.election_id=d.election_id AND c.verification_status='verified' AND c.id<>d.originator_candidacy_id
     WHERE d.id=$1 AND d.status='published' AND NOT EXISTS (SELECT 1 FROM debate_invitations i WHERE i.debate_id=d.id AND i.invited_candidacy_id=c.id)
     ORDER BY c.public_name LIMIT 100`, [debateId]);
  return r.rows;
}
