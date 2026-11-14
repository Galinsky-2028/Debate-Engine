import {randomUUID} from "node:crypto";
import type {Pool, PoolClient} from "pg";
import {
  dueSoonAt, loopbackWebhooksAllowed, obligationNotificationText, OUTBOX_LEASE_SECONDS, resultAfterAttempt,
  type AttemptOutcome, type NotificationPhase,
} from "../domain/outbox.ts";
import {notificationDedupeKey} from "../domain/deadlines.ts";
import {DeliveryRefused, postSignedWebhook, type Resolver} from "./webhook.ts";
import {emailProviderConfig, sendEmail} from "./email.ts";

/**
 * Shared outbox logic for the Next server, `scripts/outbox-worker.mjs`, and `scripts/deadline-worker.mjs`.
 * Enqueueing never sends. Sending happens only in processOutbox, one destination row at a time.
 */
type Queryable = Pick<PoolClient, "query">;
export type OutboxDestination = {id: string; kind: "webhook" | "email"; address: string; signing_secret: string | null; verified_at: Date | null; disabled_at: Date | null};
export type OutboxSendRequest = {actionId: string; actionType: string; createdAt: string; payload: OutboxPayload; destination: OutboxDestination};
export type OutboxAdapters = {webhook: (r: OutboxSendRequest) => Promise<AttemptOutcome>; email: (r: OutboxSendRequest) => Promise<AttemptOutcome>};
export type OutboxPayload = {type: string; data: Record<string, unknown>; email: {subject: string; text: string}};

export function publicOrigin(env: Record<string, string | undefined> = process.env): string {
  const raw = env.PUBLIC_APP_ORIGIN || env.RENDER_EXTERNAL_URL || "http://localhost:3000";
  return new URL(raw).origin;
}

export async function enqueueAction(db: Queryable, input: {
  actionType: "notification" | "invitation" | "distribution" | "destination_verification";
  destinationId: string; ownerCandidacyId: string; dedupeKey: string; payload: OutboxPayload;
  debateId?: string | null; branchId?: string | null; subjectKind: string; subjectId: string;
}): Promise<{id: string | null; created: boolean}> {
  const r = await db.query<{id: string}>(
    `INSERT INTO outgoing_actions(action_type,destination,dedupe_key,payload,destination_id,owner_candidacy_id,debate_id,branch_id,subject_kind,subject_id)
     VALUES($1,'destination:'||$2::uuid::text,$3,$4::jsonb,$2::uuid,$5,$6,$7,$8,$9)
     ON CONFLICT(action_type,destination,dedupe_key) DO NOTHING RETURNING id`,
    [input.actionType, input.destinationId, input.dedupeKey, JSON.stringify(input.payload), input.ownerCandidacyId,
      input.debateId ?? null, input.branchId ?? null, input.subjectKind, input.subjectId]);
  return {id: r.rows[0]?.id ?? null, created: Boolean(r.rowCount)};
}

async function notificationDestinations(db: Queryable, candidacyId: string) {
  return (await db.query<{id: string}>(
    "SELECT id FROM delivery_destinations WHERE candidacy_id=$1 AND verified_at IS NOT NULL AND disabled_at IS NULL AND 'notifications'=ANY(purposes) ORDER BY created_at,id",
    [candidacyId])).rows;
}

/** Enqueue one neutral obligation notice per verified notification destination. Repeats are no-ops. */
export async function enqueueObligationNotifications(db: Queryable, input: {obligationId: string; phase: NotificationPhase; origin?: string}) {
  const o = (await db.query<{
    id: string; debate_id: string; branch_id: string; obligated_candidacy_id: string; obligation_type: "review" | "reply";
    received_at: Date | null; effective_due_at: Date | null; title: string; superseded: boolean;
  }>(`SELECT ro.id,ro.debate_id,ro.branch_id,ro.obligated_candidacy_id,ro.obligation_type,ro.received_at,d.title,
      EXISTS(SELECT 1 FROM obligation_supersessions s WHERE s.obligation_id=ro.id) AS superseded,
      ro.due_at + COALESCE((SELECT sum(oa.seconds) FROM obligation_outage_adjustments oa WHERE oa.obligation_id=ro.id),0) * interval '1 second' AS effective_due_at
      FROM reply_obligations ro JOIN debates d ON d.id=ro.debate_id WHERE ro.id=$1`, [input.obligationId])).rows[0];
  if (!o) return 0;
  if (input.phase !== "opened" && (o.received_at || o.superseded)) return 0;
  const dueIso = o.effective_due_at ? new Date(o.effective_due_at).toISOString() : null;
  if (input.phase !== "opened" && !dueIso) return 0;
  const key = dueIso ? notificationDedupeKey(o.id, input.phase, dueIso) : `obligation:${o.id}:${input.phase}:no-deadline`;
  const debateUrl = (input.origin ?? publicOrigin()) + "/debates/" + o.debate_id;
  const email = obligationNotificationText({phase: input.phase, obligationType: o.obligation_type, debateTitle: o.title, effectiveDueAt: dueIso, debateUrl});
  let created = 0;
  for (const d of await notificationDestinations(db, o.obligated_candidacy_id)) {
    const r = await enqueueAction(db, {
      actionType: "notification", destinationId: d.id, ownerCandidacyId: o.obligated_candidacy_id, dedupeKey: key,
      debateId: o.debate_id, branchId: o.branch_id, subjectKind: "obligation", subjectId: o.id,
      payload: {type: "pde.obligation." + input.phase, email, data: {
        obligationId: o.id, obligationType: o.obligation_type, debateId: o.debate_id, branchId: o.branch_id,
        effectiveDueAt: dueIso, notice: email.subject, publicUrl: debateUrl}},
    });
    if (r.created) created++;
  }
  return created;
}

/** Next instant the deadline worker should look at an unreceived obligation. */
export function nextDeadlineCheck(openedAt: Date, effectiveDueAt: Date, now: Date): {phase: "due_soon" | null; nextAt: Date} {
  const soon = dueSoonAt(openedAt.toISOString(), effectiveDueAt.toISOString());
  if (soon && Date.parse(soon) > now.getTime()) return {phase: null, nextAt: new Date(soon)};
  return {phase: soon ? "due_soon" : null, nextAt: effectiveDueAt};
}

/** Deliver a drafted invitation through the invited candidate's own verified notification destinations only. */
export async function enqueueInvitationDelivery(db: Queryable, invitationId: string, origin?: string) {
  const inv = (await db.query<{id: string; debate_id: string; invited_candidacy_id: string; title: string; proposition: string; reply_window_hours: number | null; originator: string}>(
    `SELECT i.id,i.debate_id,i.invited_candidacy_id,d.title,d.proposition,d.reply_window_hours,c.public_name AS originator
     FROM debate_invitations i JOIN debates d ON d.id=i.debate_id JOIN candidacies c ON c.id=d.originator_candidacy_id WHERE i.id=$1`,
    [invitationId])).rows[0];
  if (!inv) return 0;
  const url = (origin ?? publicOrigin()) + "/debates/" + inv.debate_id;
  const window = inv.reply_window_hours ? `You have ${inv.reply_window_hours} hours from when this invitation is sent to respond under the published rules.` : "The published rules set no reply window.";
  const email = {
    subject: `Invitation to respond: ${inv.title}`.replace(/[\r\n]+/g, " ").slice(0, 200),
    text: [`${inv.originator} invited you to respond to a published debate.`, `Debate: ${inv.title}`, `Public record: ${url}`, window,
      "Responding is your choice. This is an automated notice from the Public Debate Engine."].join("\n"),
  };
  let created = 0;
  for (const d of await notificationDestinations(db, inv.invited_candidacy_id)) {
    const r = await enqueueAction(db, {
      actionType: "invitation", destinationId: d.id, ownerCandidacyId: inv.invited_candidacy_id, dedupeKey: "invitation:" + inv.id,
      debateId: inv.debate_id, subjectKind: "invitation", subjectId: inv.id,
      payload: {type: "pde.invitation", email, data: {invitationId: inv.id, debateId: inv.debate_id, title: inv.title, replyWindowHours: inv.reply_window_hours, publicUrl: url}},
    });
    if (r.created) created++;
  }
  return created;
}

export function webhookBody(r: OutboxSendRequest): string {
  return JSON.stringify({id: r.actionId, type: r.payload.type, createdAt: r.createdAt, data: r.payload.data});
}

/** Production adapters. Loopback destinations only with NODE_ENV!=='production' AND PDE_ALLOW_LOOPBACK_WEBHOOKS==='true'. */
export function defaultAdapters(env: Record<string, string | undefined> = process.env, options: {resolve?: Resolver; fetcher?: typeof fetch} = {}): OutboxAdapters {
  const allowLoopback = loopbackWebhooksAllowed(env);
  return {
    async webhook(r) {
      if (!r.destination.signing_secret) return {kind: "failed", retryable: false, error: "Webhook destination has no signing secret."};
      try {
        const res = await postSignedWebhook({url: r.destination.address, secret: r.destination.signing_secret, eventId: r.actionId, body: webhookBody(r), allowLoopback, resolve: options.resolve});
        if (res.status >= 200 && res.status < 300) return {kind: "delivered", receipt: "http-" + res.status};
        if (res.status >= 300 && res.status < 400) return {kind: "failed", retryable: false, error: `Destination redirected (HTTP ${res.status}); redirects are refused.`};
        if (res.status === 410) return {kind: "failed", retryable: false, error: "Destination responded HTTP 410 Gone."};
        return {kind: "failed", retryable: true, error: `Destination responded HTTP ${res.status}.`};
      } catch (error) {
        if (error instanceof DeliveryRefused) return {kind: "failed", retryable: false, error: error.message};
        return {kind: "failed", retryable: true, error: "Webhook request failed: " + (error instanceof Error ? error.message : "network error").slice(0, 200)};
      }
    },
    async email(r) {
      return sendEmail(emailProviderConfig(env), {to: r.destination.address, subject: r.payload.email.subject, text: r.payload.email.text}, options.fetcher);
    },
  };
}

type Claimed = {id: string; action_type: string; payload: OutboxPayload; attempts: number; max_attempts: number; lease_token: string; created_at: Date; destination_id: string; subject_kind: string | null; subject_id: string | null};
async function claim(pool: Pool): Promise<Claimed | null> {
  const r = await pool.query<Claimed>(`
    WITH c AS (
      SELECT o.id FROM outgoing_actions o
      WHERE o.destination_id IS NOT NULL AND (
        (o.state IN ('pending','failed') AND o.next_attempt_at <= now()) OR
        (o.state='sending' AND o.lease_expires_at < now()))
      ORDER BY o.next_attempt_at,o.id FOR UPDATE SKIP LOCKED LIMIT 1)
    UPDATE outgoing_actions o SET state='sending',attempts=o.attempts+1,lease_token=$1,
      lease_expires_at=now()+($2*interval '1 second'),last_attempt_at=now()
    FROM c WHERE o.id=c.id
    RETURNING o.id,o.action_type,o.payload,o.attempts,o.max_attempts,o.lease_token,o.created_at,o.destination_id,o.subject_kind,o.subject_id`,
    [randomUUID(), OUTBOX_LEASE_SECONDS]);
  return r.rows[0] ?? null;
}

export type OutboxRunSummary = {processed: number; delivered: number; accepted: number; retrying: number; dead: number; unconfigured: number};

/** Claim with FOR UPDATE SKIP LOCKED + lease, send, record. A stale lease holder can never overwrite a result. */
export async function processOutbox(pool: Pool, options: {limit?: number; adapters?: OutboxAdapters} = {}): Promise<OutboxRunSummary> {
  const limit = Math.max(1, Math.min(100, options.limit ?? 10));
  const adapters = options.adapters ?? defaultAdapters();
  const summary: OutboxRunSummary = {processed: 0, delivered: 0, accepted: 0, retrying: 0, dead: 0, unconfigured: 0};
  const seen = new Set<string>();
  while (summary.processed < limit) {
    const job = await claim(pool);
    if (!job) break;
    if (seen.has(job.id)) { await release(pool, job); break; }
    seen.add(job.id);
    const dest = (await pool.query<OutboxDestination>(
      "SELECT id,kind,address,signing_secret,verified_at,disabled_at FROM delivery_destinations WHERE id=$1", [job.destination_id])).rows[0];
    let outcome: AttemptOutcome;
    if (!dest || dest.disabled_at) outcome = {kind: "failed", retryable: false, error: "Destination was disabled before delivery."};
    else if (!dest.verified_at && job.action_type !== "destination_verification") outcome = {kind: "failed", retryable: false, error: "Destination is not verified."};
    else if (job.action_type === "distribution" && job.subject_kind === "derivative_artifact" && !await summaryGrantsCurrent(pool, job.subject_id))
      outcome = {kind: "failed", retryable: false, error: "A source owner withdrew editing or distribution permission before delivery; not sent."};
    else {
      const request: OutboxSendRequest = {actionId: job.id, actionType: job.action_type, createdAt: new Date(job.created_at).toISOString(), payload: job.payload, destination: dest};
      try { outcome = await (dest.kind === "webhook" ? adapters.webhook(request) : adapters.email(request)); }
      catch (error) { outcome = {kind: "failed", retryable: true, error: error instanceof Error ? error.message : "Adapter error"}; }
    }
    const result = resultAfterAttempt({attempts: job.attempts, maxAttempts: job.max_attempts, outcome});
    await pool.query(`
      UPDATE outgoing_actions SET state=$3,attempts=attempts+$4,
        next_attempt_at=CASE WHEN $5::integer IS NULL THEN next_attempt_at ELSE now()+($5::integer*interval '1 second') END,
        last_error=$6,provider_receipt=COALESCE($7,provider_receipt),
        accepted_at=CASE WHEN $8 THEN COALESCE(accepted_at,now()) ELSE accepted_at END,
        delivered_at=CASE WHEN $9 THEN COALESCE(delivered_at,now()) ELSE delivered_at END,
        dead_at=CASE WHEN $3='dead' THEN now() ELSE dead_at END,
        lease_token=NULL,lease_expires_at=NULL
      WHERE id=$1 AND lease_token=$2 AND state='sending'`,
      [job.id, job.lease_token, result.state, result.attemptsDelta, result.retryInSeconds, result.lastError, result.providerReceipt, result.markAccepted, result.markDelivered]);
    summary.processed++;
    if (result.state === "delivered") summary.delivered++;
    else if (result.state === "accepted") summary.accepted++;
    else if (result.state === "dead") summary.dead++;
    else if (outcome.kind === "unconfigured") summary.unconfigured++;
    else summary.retrying++;
  }
  return summary;
}
/** A summary queued for distribution is re-checked at send time: a withdrawn edit or distribute grant stops it. */
async function summaryGrantsCurrent(pool: Pool, artifactId: string | null) {
  if (!artifactId) return false;
  const r = await pool.query<{ok: boolean}>(
    "SELECT COALESCE(public.pde_artifact_edit_grants_current($1::uuid),false) AND COALESCE(public.pde_artifact_distribute_grants_current($1::uuid),false) AS ok", [artifactId]);
  return Boolean(r.rows[0]?.ok);
}
async function release(pool: Pool, job: Claimed) {
  await pool.query("UPDATE outgoing_actions SET state='pending',attempts=attempts-1,lease_token=NULL,lease_expires_at=NULL WHERE id=$1 AND lease_token=$2 AND state='sending'", [job.id, job.lease_token]);
}

/** Admin dead-letter recovery: grant three more attempts, keep the recorded error history in last_error until the next attempt. */
export async function retryDeadLetter(db: Queryable, actionId: string) {
  const r = await db.query<{id: string}>(
    "UPDATE outgoing_actions SET state='pending',max_attempts=LEAST(100,attempts+3),next_attempt_at=now(),dead_at=NULL WHERE id=$1 AND state='dead' RETURNING id",
    [actionId]);
  return Boolean(r.rowCount);
}
