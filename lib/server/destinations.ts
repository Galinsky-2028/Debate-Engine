import "server-only";
import {createHash, randomBytes, randomUUID} from "node:crypto";
import type {PoolClient} from "pg";
import {database, transaction} from "./db";
import {HttpError} from "./http";
import {labelled, type DeliveryRow} from "./outbox";
import {
  headerSafe, loopbackWebhooksAllowed, MAX_ACTIVE_DESTINATIONS, validateEmailAddress, validatePurposes, validateWebhookUrl,
  type DestinationKind,
} from "../../packages/domain/outbox.ts";
import {enqueueAction, publicOrigin} from "../../packages/delivery/outbox-store.ts";
import {emailProviderConfig} from "../../packages/delivery/email.ts";
import {runWebhookChallenge} from "../../packages/delivery/webhook.ts";

const sha256 = (value: string) => createHash("sha256").update(value).digest("hex");

/** The candidate actor is proven in SQL: candidacy + Neon auth subject + verified status. */
export async function ownedCandidacy(db: Pick<PoolClient, "query">, candidacyId: string, authSubject: string) {
  const r = await db.query<{account_id: string}>(
    "SELECT a.id AS account_id FROM candidacies c JOIN accounts a ON a.id=c.account_id WHERE c.id=$1 AND c.verification_status='verified' AND a.identity_provider='neon-auth' AND a.external_subject=$2",
    [candidacyId, authSubject]);
  if (!r.rowCount) throw new HttpError(403, "Only the verified candidate may manage these destinations.");
  return r.rows[0];
}
async function ownedDestination(db: PoolClient, destinationId: string, authSubject: string) {
  const r = await db.query<{id: string; candidacy_id: string; kind: DestinationKind; address: string; signing_secret: string | null; verified_at: Date | null; disabled_at: Date | null; account_id: string}>(
    "SELECT d.id,d.candidacy_id,d.kind,d.address,d.signing_secret,d.verified_at,d.disabled_at,a.id AS account_id FROM delivery_destinations d JOIN candidacies c ON c.id=d.candidacy_id AND c.verification_status='verified' JOIN accounts a ON a.id=c.account_id WHERE d.id=$1 AND a.identity_provider='neon-auth' AND a.external_subject=$2 FOR UPDATE OF d",
    [destinationId, authSubject]);
  if (!r.rowCount) throw new HttpError(404, "Destination not found for your verified candidacy.");
  return r.rows[0];
}
const audit = (db: Pick<PoolClient, "query">, accountId: string, action: string, id: string, context: object = {}) =>
  db.query("INSERT INTO audit_events(actor_account_id,action,target_kind,target_id,context) VALUES($1,$2,'delivery_destination',$3,$4::jsonb)", [accountId, action, id, JSON.stringify(context)]);

export function destinationStatus(row: {kind: string; verified_at: unknown; disabled_at: unknown}) {
  if (row.disabled_at) return "disabled";
  if (row.verified_at) return "verified";
  if (row.kind === "email" && !emailProviderConfig(process.env)) return "unverified — no email provider configured";
  return "unverified";
}

export async function createDestination(input: {authSubject: string; candidacyId: string; kind: unknown; label: string; address: string; purposes: unknown}) {
  if (input.kind !== "webhook" && input.kind !== "email") throw new HttpError(400, "kind must be webhook or email.");
  const kind: DestinationKind = input.kind;
  let purposes: string[], address: string;
  try {
    purposes = validatePurposes(input.purposes);
    address = kind === "webhook" ? validateWebhookUrl(input.address, {allowLoopback: loopbackWebhooksAllowed(process.env)}).toString() : validateEmailAddress(input.address);
  } catch (e) { throw new HttpError(400, (e as Error).message); }
  const label = headerSafe(input.label, 120);
  if (!label) throw new HttpError(400, "A label is required.");
  const signingSecret = kind === "webhook" ? randomBytes(32).toString("base64url") : null;
  const created = await transaction(async db => {
    const owner = await ownedCandidacy(db, input.candidacyId, input.authSubject);
    await db.query("SELECT 1 FROM candidacies WHERE id=$1 FOR UPDATE", [input.candidacyId]);
    const active = await db.query<{n: number}>("SELECT count(*)::int AS n FROM delivery_destinations WHERE candidacy_id=$1 AND disabled_at IS NULL", [input.candidacyId]);
    if (active.rows[0].n >= MAX_ACTIVE_DESTINATIONS) throw new HttpError(409, `At most ${MAX_ACTIVE_DESTINATIONS} active destinations are allowed. Disable one first.`);
    const dup = await db.query("SELECT 1 FROM delivery_destinations WHERE candidacy_id=$1 AND kind=$2 AND lower(address)=lower($3) AND disabled_at IS NULL", [input.candidacyId, kind, address]);
    if (dup.rowCount) throw new HttpError(409, "This destination is already registered.");
    const row = await db.query<{id: string; created_at: string}>(
      "INSERT INTO delivery_destinations(candidacy_id,created_by_account_id,kind,purposes,label,address,signing_secret) VALUES($1,$2,$3,$4::text[],$5,$6,$7) RETURNING id,created_at",
      [input.candidacyId, owner.account_id, kind, purposes, label, address, signingSecret]);
    await audit(db, owner.account_id, "delivery_destination_added", row.rows[0].id, {kind, purposes});
    return row.rows[0];
  });
  let emailVerification: string | null = null;
  if (kind === "email") emailVerification = (await startEmailVerification({authSubject: input.authSubject, destinationId: created.id}).catch(e => ({status: (e as Error).message}))).status;
  return {
    destination: {id: created.id, kind, label, address, purposes, createdAt: created.created_at, status: kind === "email" ? destinationStatus({kind, verified_at: null, disabled_at: null}) : "unverified"},
    // Shown exactly once. It is never listed again.
    signingSecret, emailVerification,
  };
}

export async function listDestinations(authSubject: string, candidacyId: string) {
  await ownedCandidacy(database(), candidacyId, authSubject);
  const rows = await database().query<{id: string; kind: string; label: string; address: string; purposes: string[]; verified_at: string | null; disabled_at: string | null; created_at: string}>(
    "SELECT id,kind,label,address,purposes,verified_at,disabled_at,created_at FROM delivery_destinations WHERE candidacy_id=$1 ORDER BY disabled_at NULLS FIRST,created_at DESC LIMIT 50", [candidacyId]);
  const history = await database().query<DeliveryRow>(
    `SELECT o.id,o.action_type,o.state,o.attempts,o.max_attempts,o.last_error,o.created_at,o.last_attempt_at,o.accepted_at,o.delivered_at,o.next_attempt_at,
      o.destination_id,d.label AS destination_label,d.kind AS destination_kind,o.subject_kind,o.subject_id
     FROM outgoing_actions o JOIN delivery_destinations d ON d.id=o.destination_id WHERE d.candidacy_id=$1 ORDER BY o.created_at DESC,o.id LIMIT 100`, [candidacyId]);
  return {
    emailProviderConfigured: Boolean(emailProviderConfig(process.env)),
    destinations: rows.rows.map(r => ({...r, status: destinationStatus(r)})),
    deliveries: history.rows.map(labelled),
  };
}

/** Webhook proof of control: the endpoint must echo a signed one-time challenge. */
export async function verifyWebhookDestination(input: {authSubject: string; destinationId: string}) {
  const dest = await transaction(db => ownedDestination(db, input.destinationId, input.authSubject));
  if (dest.kind !== "webhook") throw new HttpError(400, "Use the email confirmation link for email destinations.");
  if (dest.disabled_at) throw new HttpError(409, "Disabled destinations cannot be verified.");
  if (dest.verified_at) return {verified: true, already: true};
  const {ok, detail} = await runWebhookChallenge({url: dest.address, secret: dest.signing_secret!, challenge: randomBytes(24).toString("base64url"), eventId: randomUUID(), allowLoopback: loopbackWebhooksAllowed(process.env)});
  if (!ok) throw new HttpError(422, "Verification failed: " + detail);
  await transaction(async db => {
    const d = await ownedDestination(db, input.destinationId, input.authSubject);
    if (d.disabled_at) throw new HttpError(409, "Destination was disabled.");
    if (!d.verified_at) {
      await db.query("UPDATE delivery_destinations SET verified_at=now() WHERE id=$1", [d.id]);
      await audit(db, d.account_id, "delivery_destination_verified", d.id, {kind: "webhook"});
    }
  });
  return {verified: true, already: false};
}

/** Email proof of control: a single-use, expiring link mailed through the configured provider only. */
export async function startEmailVerification(input: {authSubject: string; destinationId: string}) {
  if (!emailProviderConfig(process.env)) return {status: "unverified — no email provider configured", queued: false};
  return transaction(async db => {
    const d = await ownedDestination(db, input.destinationId, input.authSubject);
    if (d.kind !== "email") throw new HttpError(400, "Only email destinations use confirmation links.");
    if (d.disabled_at) throw new HttpError(409, "Disabled destinations cannot be verified.");
    if (d.verified_at) return {status: "verified", queued: false};
    const token = randomBytes(32).toString("base64url"), digest = sha256(token);
    await db.query("UPDATE delivery_destinations SET verification_token_sha256=$2,verification_expires_at=now()+interval '72 hours' WHERE id=$1", [d.id, digest]);
    const link = publicOrigin() + "/workspace/destinations/confirm?d=" + d.id + "&t=" + token;
    await enqueueAction(db, {
      actionType: "destination_verification", destinationId: d.id, ownerCandidacyId: d.candidacy_id, dedupeKey: "verify:" + digest,
      subjectKind: "delivery_destination", subjectId: d.id,
      payload: {type: "pde.destination.verification", data: {destinationId: d.id}, email: {
        subject: "Confirm this address for Public Debate Engine notices",
        text: ["A verified candidate account asked to send debate notices to this address.", "Confirm within 72 hours:", link,
          "If you did not expect this, ignore it; nothing will be sent here without confirmation."].join("\n")}},
    });
    await audit(db, d.account_id, "delivery_destination_confirmation_queued", d.id);
    return {status: "confirmation queued — check the mailbox once the provider accepts it", queued: true};
  });
}

export async function confirmEmailDestination(destinationId: string, token: string) {
  if (!/^[A-Za-z0-9_-]{43}$/.test(token)) throw new HttpError(400, "Invalid confirmation token.");
  const r = await database().query<{id: string}>(
    "UPDATE delivery_destinations SET verified_at=now(),verification_token_sha256=NULL,verification_expires_at=NULL WHERE id=$1 AND kind='email' AND verified_at IS NULL AND disabled_at IS NULL AND verification_token_sha256=$2 AND verification_expires_at>now() RETURNING id",
    [destinationId, sha256(token)]);
  if (!r.rowCount) throw new HttpError(410, "This confirmation link is invalid, already used, or expired.");
  await database().query("INSERT INTO audit_events(action,target_kind,target_id) VALUES('delivery_destination_verified','delivery_destination',$1)", [destinationId]);
  return {verified: true};
}

export async function disableDestination(input: {authSubject: string; destinationId: string}) {
  return transaction(async db => {
    const d = await ownedDestination(db, input.destinationId, input.authSubject);
    if (!d.disabled_at) {
      await db.query("UPDATE delivery_destinations SET disabled_at=now(),verification_token_sha256=NULL,verification_expires_at=NULL WHERE id=$1", [d.id]);
      await audit(db, d.account_id, "delivery_destination_disabled", d.id);
    }
    return {disabled: true};
  });
}
