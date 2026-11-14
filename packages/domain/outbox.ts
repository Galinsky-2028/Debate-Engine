import {createHmac, timingSafeEqual} from "node:crypto";
import {isIP} from "node:net";

/** Durable outbox rules (PDE-14 / PDE-23). Pure: no database, network, or framework imports. */
export type OutboxState = "pending" | "sending" | "accepted" | "delivered" | "failed" | "dead";
export type DeliveryLabel = "queued" | "sending" | "provider_accepted" | "delivered" | "retrying" | "failed" | "dead";
export type DestinationKind = "webhook" | "email";
export type DestinationPurpose = "notifications" | "distribution";

export const OUTBOX_MAX_ATTEMPTS = 8;
export const OUTBOX_LEASE_SECONDS = 60;
export const MAX_ACTIVE_DESTINATIONS = 10;
export const WEBHOOK_TIMEOUT_MS = 10_000;
export const WEBHOOK_MAX_REQUEST_BYTES = 64 * 1024;
export const WEBHOOK_MAX_RESPONSE_BYTES = 16 * 1024;
export const SIGNATURE_TOLERANCE_SECONDS = 300;
export const PROVIDER_UNCONFIGURED = "provider_unconfigured";
const BACKOFF_SECONDS = [30, 120, 600, 1800, 3600, 3 * 3600, 6 * 3600, 12 * 3600] as const;

/** Seconds to wait before the next attempt after `attempts` failed attempts (1-based). */
export function backoffSeconds(attempts: number, random: () => number = () => 0): number {
  if (!Number.isInteger(attempts) || attempts < 1) throw new Error("attempts must be a positive integer.");
  const base = BACKOFF_SECONDS[Math.min(attempts, BACKOFF_SECONDS.length) - 1];
  const jitter = Math.max(0, Math.min(1, random()));
  return Math.round(base * (1 + jitter * 0.2));
}

export type AttemptOutcome =
  | {kind: "delivered"; receipt: string}
  | {kind: "accepted"; receipt: string}
  | {kind: "unconfigured"}
  | {kind: "failed"; retryable: boolean; error: string};

export type AttemptResult = {
  state: OutboxState;
  attemptsDelta: 0 | -1;
  retryInSeconds: number | null;
  lastError: string | null;
  providerReceipt: string | null;
  markAccepted: boolean;
  markDelivered: boolean;
};

/**
 * Decide the stored result of a claimed attempt. `attempts` already includes the claimed attempt.
 * Unconfigured providers never count as an attempt and never become sent/accepted.
 */
export function resultAfterAttempt(input: {attempts: number; maxAttempts: number; outcome: AttemptOutcome}): AttemptResult {
  const {attempts, maxAttempts, outcome} = input;
  if (!Number.isInteger(maxAttempts) || maxAttempts < 1) throw new Error("maxAttempts must be positive.");
  switch (outcome.kind) {
    case "delivered":
      return {state: "delivered", attemptsDelta: 0, retryInSeconds: null, lastError: null, providerReceipt: clip(outcome.receipt, 300), markAccepted: true, markDelivered: true};
    case "accepted":
      return {state: "accepted", attemptsDelta: 0, retryInSeconds: null, lastError: null, providerReceipt: clip(outcome.receipt, 300), markAccepted: true, markDelivered: false};
    case "unconfigured":
      return {state: "pending", attemptsDelta: -1, retryInSeconds: 900, lastError: PROVIDER_UNCONFIGURED, providerReceipt: null, markAccepted: false, markDelivered: false};
    case "failed": {
      const error = clip(outcome.error || "Unknown delivery failure", 500);
      if (!outcome.retryable || attempts >= maxAttempts)
        return {state: "dead", attemptsDelta: 0, retryInSeconds: null, lastError: error, providerReceipt: null, markAccepted: false, markDelivered: false};
      return {state: "failed", attemptsDelta: 0, retryInSeconds: backoffSeconds(attempts), lastError: error, providerReceipt: null, markAccepted: false, markDelivered: false};
    }
  }
}

const TRANSITIONS: Record<OutboxState, readonly OutboxState[]> = {
  pending: ["sending", "dead"],
  sending: ["sending", "pending", "accepted", "delivered", "failed", "dead"],
  failed: ["sending", "dead"],
  accepted: ["delivered"],
  delivered: [],
  dead: ["pending"],
};
/** Success is terminal: an accepted or delivered action can never return to a sendable state. */
export function canTransition(from: OutboxState, to: OutboxState): boolean {
  return TRANSITIONS[from]?.includes(to) ?? false;
}

/** Truthful per-destination label for candidate/admin views. */
export function deliveryLabel(row: {state: OutboxState; attempts: number; maxAttempts: number; lastError?: string | null}): DeliveryLabel {
  switch (row.state) {
    case "pending": return row.attempts > 0 ? "retrying" : "queued";
    case "sending": return "sending";
    case "accepted": return "provider_accepted";
    case "delivered": return "delivered";
    case "failed": return "retrying";
    case "dead": return row.attempts >= row.maxAttempts ? "dead" : "failed";
  }
}

export const DELIVERY_LABEL_TEXT: Record<DeliveryLabel, string> = {
  queued: "Queued — not sent",
  sending: "Sending",
  provider_accepted: "Accepted by provider (delivery not confirmed)",
  delivered: "Delivered (destination confirmed receipt)",
  retrying: "Attempt failed — retry scheduled",
  failed: "Failed — not retried",
  dead: "Failed after all retries (dead letter)",
};

/** HMAC-SHA256 over `timestamp.eventId.body`; header value `v1=<hex>`. */
export function signWebhook(secret: string, timestamp: number, eventId: string, body: string): string {
  if (!secret || secret.length < 32) throw new Error("A webhook signing secret of at least 32 characters is required.");
  if (!Number.isSafeInteger(timestamp) || timestamp <= 0) throw new Error("timestamp must be Unix seconds.");
  if (!eventId) throw new Error("eventId is required.");
  return "v1=" + createHmac("sha256", secret).update(`${timestamp}.${eventId}.${body}`).digest("hex");
}

/** Receiver-side verification with a replay window. Receivers must also remember event ids they processed. */
export function verifyWebhookSignature(input: {secret: string; signature: string; timestamp: string | number; eventId: string; body: string; nowSeconds: number; toleranceSeconds?: number}): boolean {
  const ts = Number(input.timestamp);
  if (!Number.isSafeInteger(ts) || Math.abs(input.nowSeconds - ts) > (input.toleranceSeconds ?? SIGNATURE_TOLERANCE_SECONDS)) return false;
  let expected: string;
  try { expected = signWebhook(input.secret, ts, input.eventId, input.body); } catch { return false; }
  const a = Buffer.from(expected), b = Buffer.from(String(input.signature));
  return a.length === b.length && timingSafeEqual(a, b);
}

function ipv4Parts(address: string): number[] | null {
  const parts = address.split(".");
  if (parts.length !== 4) return null;
  const nums = parts.map(Number);
  return nums.every((n, i) => /^\d{1,3}$/.test(parts[i]) && n >= 0 && n <= 255) ? nums : null;
}
function forbiddenV4([a, b, c]: number[]): boolean {
  return a === 0 || a === 10 || a === 127 || a >= 224 ||
    (a === 100 && b >= 64 && b <= 127) ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    (a === 192 && b === 0 && (c === 0 || c === 2)) ||
    (a === 198 && (b === 18 || b === 19)) ||
    (a === 198 && b === 51 && c === 100) ||
    (a === 203 && b === 0 && c === 113);
}
function expandV6(address: string): number[] | null {
  let text = address.toLowerCase().split("%")[0];
  const v4 = text.match(/(\d+\.\d+\.\d+\.\d+)$/);
  if (v4) {
    const p = ipv4Parts(v4[1]);
    if (!p) return null;
    text = text.slice(0, -v4[1].length) + ((p[0] << 8) | p[1]).toString(16) + ":" + ((p[2] << 8) | p[3]).toString(16);
  }
  const halves = text.split("::");
  if (halves.length > 2) return null;
  const parse = (s: string) => (s ? s.split(":").map(h => (/^[0-9a-f]{1,4}$/.test(h) ? parseInt(h, 16) : NaN)) : []);
  const head = parse(halves[0]), rest = halves.length === 2 ? parse(halves[1]) : [];
  let out: number[];
  if (halves.length === 2) {
    const fill = 8 - head.length - rest.length;
    if (fill < 1) return null;
    out = [...head, ...new Array(fill).fill(0), ...rest];
  } else out = head;
  return out.length === 8 && !out.some(Number.isNaN) ? out : null;
}

/** True when an IP literal is loopback, private, link-local, metadata, multicast, reserved, or unparseable. */
export function isForbiddenAddress(address: string): boolean {
  const family = isIP(address.split("%")[0]);
  if (family === 4) { const p = ipv4Parts(address); return !p || forbiddenV4(p); }
  if (family !== 6) return true;
  const g = expandV6(address);
  if (!g) return true;
  if (g.every(x => x === 0)) return true; // ::
  if (g.slice(0, 7).every(x => x === 0) && g[7] === 1) return true; // ::1
  const embedded = (hi: number, lo: number) => forbiddenV4([hi >> 8, hi & 255, lo >> 8, lo & 255]);
  if (g.slice(0, 5).every(x => x === 0) && g[5] === 0xffff) return embedded(g[6], g[7]); // ::ffff:a.b.c.d
  if (g.slice(0, 6).every(x => x === 0)) return true; // deprecated IPv4-compatible
  if (g[0] === 0x64 && g[1] === 0xff9b) return embedded(g[6], g[7]); // NAT64
  if (g[0] === 0x2002) return embedded(g[1], g[2]); // 6to4
  if ((g[0] & 0xfe00) === 0xfc00) return true; // unique local fc00::/7 (includes fd00:ec2::254)
  if ((g[0] & 0xffc0) === 0xfe80 || (g[0] & 0xffc0) === 0xfec0) return true; // link/site-local
  if ((g[0] & 0xff00) === 0xff00) return true; // multicast
  if (g[0] === 0x2001 && g[1] === 0x0db8) return true; // documentation
  if (g[0] === 0x2001 && g[1] < 0x200) return true; // Teredo / benchmarking / ORCHID
  if (g[0] === 0x0100 && g.slice(1, 4).every(x => x === 0)) return true; // discard-only
  return false;
}
export function isLoopbackAddress(address: string): boolean {
  const p = ipv4Parts(address);
  if (p) return p[0] === 127;
  const g = isIP(address) === 6 ? expandV6(address) : null;
  return !!g && g.slice(0, 7).every(x => x === 0) && g[7] === 1;
}

/** Loopback webhooks exist only for local integration tests, never in production. */
export function loopbackWebhooksAllowed(env: Record<string, string | undefined>): boolean {
  return env.NODE_ENV !== "production" && env.PDE_ALLOW_LOOPBACK_WEBHOOKS === "true";
}

const BLOCKED_HOSTNAMES = /(^|\.)(localhost|local|internal|localdomain|home\.arpa|in-addr\.arpa|ip6\.arpa)$/i;
/** Static URL rules; the DNS answer must additionally pass isForbiddenAddress before connecting. */
export function validateWebhookUrl(raw: string, options: {allowLoopback?: boolean} = {}): URL {
  if (typeof raw !== "string" || raw.length > 500 || /[\s\u0000-\u001f]/.test(raw)) throw new Error("Webhook URL is invalid.");
  let url: URL;
  try { url = new URL(raw); } catch { throw new Error("Webhook URL is invalid."); }
  const host = url.hostname.replace(/^\[|\]$/g, "");
  const loopbackTest = options.allowLoopback === true && isLoopbackAddress(host);
  if (url.protocol !== "https:" && !(loopbackTest && url.protocol === "http:")) throw new Error("Webhook destinations must use HTTPS.");
  if (url.username || url.password) throw new Error("Webhook URLs cannot contain credentials.");
  if (url.hash) throw new Error("Webhook URLs cannot contain a fragment.");
  if (loopbackTest) return url;
  if (url.port && !["443", "8443"].includes(url.port)) throw new Error("Webhook destinations must use port 443 or 8443.");
  if (isIP(host)) { if (isForbiddenAddress(host)) throw new Error("Webhook destination address is not publicly routable."); return url; }
  if (!host.includes(".") || BLOCKED_HOSTNAMES.test(host) || host === "metadata.google.internal") throw new Error("Webhook destination host is not publicly routable.");
  return url;
}

/** One mailbox only: lists, display names, and header-breaking characters are refused. */
export function validateEmailAddress(raw: string): string {
  const value = typeof raw === "string" ? raw.trim() : "";
  if (value.length < 3 || value.length > 254 || /[\s,;<>"'()\[\]\\\u0000-\u001f\u007f]/.test(value) ||
    !/^[A-Za-z0-9.!#$%&*+/=?^_`{|}~-]+@[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?(?:\.[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?)+$/.test(value))
    throw new Error("Enter exactly one email address.");
  return value.toLowerCase();
}

/** Remove CR/LF and other control characters from any header-like field (subject, from, to, labels). */
export function headerSafe(value: string, max = 300): string {
  return clip(String(value ?? "").replace(/[\u0000-\u001f\u007f\u2028\u2029]+/g, " ").replace(/\s{2,}/g, " ").trim(), max);
}

export function validatePurposes(value: unknown): DestinationPurpose[] {
  if (!Array.isArray(value) || value.length < 1 || value.length > 4) throw new Error("Choose notifications, distribution, or both.");
  const set = new Set<DestinationPurpose>();
  for (const v of value) {
    if (v !== "notifications" && v !== "distribution") throw new Error("Unknown destination purpose.");
    set.add(v);
  }
  return [...set].sort();
}

function clip(value: string, max: number) { return value.length > max ? value.slice(0, max) : value; }

/** Neutral notification text. The engine never states or implies that a candidate conceded or lost. */
export type NotificationPhase = "opened" | "due_soon" | "overdue";
export function obligationNotificationText(input: {phase: NotificationPhase; obligationType: "review" | "reply"; debateTitle: string; effectiveDueAt: string | null; debateUrl: string}) {
  const due = input.effectiveDueAt ? formatInstant(input.effectiveDueAt) : null;
  const what = input.obligationType === "review" ? "Review" : "Response";
  const title = headerSafe(input.debateTitle, 160);
  let subject: string;
  if (input.phase === "overdue") subject = due ? `No response received by ${due}` : "No response received";
  else subject = due ? `${what} due ${due}` : `${what} requested — no deadline`;
  const lines = [subject, `Debate: ${title}`, `Public record: ${input.debateUrl}`,
    "A late response can still be published and remains part of the public record. This message is an automated notice, not a judgment."];
  return {subject: headerSafe(`${subject} — ${title}`, 200), text: lines.join("\n")};
}
export function formatInstant(iso: string): string {
  const d = new Date(iso);
  if (!Number.isFinite(d.getTime())) throw new Error("Invalid instant.");
  return d.toISOString().replace("T", " ").replace(/:\d\d\.\d{3}Z$/, " UTC");
}

/** A due-soon notice fires 24 hours before the effective deadline, only for windows longer than 48 hours. */
export function dueSoonAt(openedAt: string, effectiveDueAt: string): string | null {
  const opened = Date.parse(openedAt), due = Date.parse(effectiveDueAt);
  if (!Number.isFinite(opened) || !Number.isFinite(due)) throw new Error("Invalid instants.");
  if (due - opened <= 48 * 3600_000) return null;
  return new Date(due - 24 * 3600_000).toISOString();
}
