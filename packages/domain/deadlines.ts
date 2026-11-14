export type ObligationState = "open" | "overdue" | "fulfilled_on_time" | "fulfilled_late" | "superseded_by_agreement";

export type OutageAdjustment = {
  id: string;
  seconds: number;
};

export type ObligationClock = {
  id: string;
  openedAt: string;
  dueAt: string | null;
  receivedAt?: string | null;
  processedAt?: string | null;
  adjustments?: readonly OutageAdjustment[];
  /** Set when a current joint full-scope agreement closed the still-open obligation (migration 0032). */
  supersededAt?: string | null;
};

export type ObligationProjection = {
  state: ObligationState;
  effectiveDueAt: string | null;
  receivedAt: string | null;
  processedAt: string | null;
  supersededAt: string | null;
};

/** Neutral public wording for every obligation state. A missed deadline is never described as a concession. */
export const OBLIGATION_STATE_LABELS: Record<ObligationState, string> = {
  open: "Response due",
  overdue: "No response received by the due date",
  fulfilled_on_time: "Completed on time",
  fulfilled_late: "Reply received late",
  superseded_by_agreement: "Closed by the candidates' recorded agreement",
};

export function obligationStateLabel(state: string): string {
  return (OBLIGATION_STATE_LABELS as Record<string, string>)[state] ?? state;
}

function instant(value: string, label: string): number {
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed)) throw new Error(`${label} must be an ISO-8601 instant.`);
  return parsed;
}

function uniqueAdjustmentSeconds(adjustments: readonly OutageAdjustment[]): number {
  const seen = new Set<string>();
  let total = 0;
  for (const adjustment of adjustments) {
    if (!adjustment.id || seen.has(adjustment.id)) throw new Error("Outage adjustment identifiers must be unique.");
    if (!Number.isSafeInteger(adjustment.seconds) || adjustment.seconds <= 0) {
      throw new Error("Outage adjustment seconds must be positive integers.");
    }
    seen.add(adjustment.id);
    total += adjustment.seconds;
  }
  return total;
}

/** Project an obligation from server-authoritative instants. Receipt time, not later processing, decides timeliness. */
export function projectObligation(clock: ObligationClock, now: string): ObligationProjection {
  const openedAt = instant(clock.openedAt, "openedAt");
  const observedAt = instant(now, "now");
  if (observedAt < openedAt) throw new Error("now cannot precede the obligation opening time.");

  const dueAt = clock.dueAt === null ? null : instant(clock.dueAt, "dueAt");
  if (dueAt !== null && dueAt < openedAt) throw new Error("dueAt cannot precede openedAt.");
  const effectiveDue = dueAt === null ? null : dueAt + uniqueAdjustmentSeconds(clock.adjustments ?? []) * 1000;
  const receivedAt = clock.receivedAt ? instant(clock.receivedAt, "receivedAt") : null;
  const processedAt = clock.processedAt ? instant(clock.processedAt, "processedAt") : null;
  if (receivedAt !== null && receivedAt < openedAt) throw new Error("receivedAt cannot precede openedAt.");
  if (processedAt !== null && receivedAt === null) throw new Error("Processing cannot succeed without a receipt.");
  if (processedAt !== null && processedAt < receivedAt!) throw new Error("processedAt cannot precede receivedAt.");

  const supersededAt = clock.supersededAt ? instant(clock.supersededAt, "supersededAt") : null;
  if (supersededAt !== null && receivedAt !== null) throw new Error("A received obligation cannot be superseded.");
  if (supersededAt !== null && supersededAt < openedAt) throw new Error("supersededAt cannot precede openedAt.");

  let state: ObligationState;
  // An agreement that closed the obligation before anything was received is not a missed deadline, even after due time.
  if (supersededAt !== null) state = "superseded_by_agreement";
  else if (receivedAt !== null) state = effectiveDue === null || receivedAt <= effectiveDue ? "fulfilled_on_time" : "fulfilled_late";
  else state = effectiveDue !== null && observedAt > effectiveDue ? "overdue" : "open";

  return {
    state,
    effectiveDueAt: effectiveDue === null ? null : new Date(effectiveDue).toISOString(),
    receivedAt: receivedAt === null ? null : new Date(receivedAt).toISOString(),
    processedAt: processedAt === null ? null : new Date(processedAt).toISOString(),
    supersededAt: supersededAt === null ? null : new Date(supersededAt).toISOString(),
  };
}

/** A direct-invitation clock cannot begin before both the proposal is usable and provider evidence says it was sent. */
export function invitedReplyOpenedAt(proposalUsableAt: string, providerAcceptedAt: string | null): string | null {
  if (providerAcceptedAt === null) return null;
  return new Date(Math.max(instant(proposalUsableAt, "proposalUsableAt"), instant(providerAcceptedAt, "providerAcceptedAt"))).toISOString();
}

export function notificationDedupeKey(obligationId: string, phase: "opened" | "due_soon" | "overdue", effectiveDueAt: string): string {
  if (!obligationId) throw new Error("obligationId is required.");
  instant(effectiveDueAt, "effectiveDueAt");
  return `obligation:${obligationId}:${phase}:${effectiveDueAt}`;
}

export const OUTAGE_EXTENSION_MIN_SECONDS = 60;
export const OUTAGE_EXTENSION_MAX_SECONDS = 30 * 24 * 60 * 60;

/** Validate an administrator's documented outage extension. The reason is published verbatim. */
export function parseOutageExtension(raw: {seconds: unknown; publicReason: unknown}): {seconds: number; publicReason: string} {
  const seconds = Number(raw.seconds);
  if (!Number.isSafeInteger(seconds) || seconds < OUTAGE_EXTENSION_MIN_SECONDS || seconds > OUTAGE_EXTENSION_MAX_SECONDS)
    throw new Error(`An outage extension must be a whole number of seconds from ${OUTAGE_EXTENSION_MIN_SECONDS} to ${OUTAGE_EXTENSION_MAX_SECONDS}.`);
  const publicReason = typeof raw.publicReason === "string" ? raw.publicReason.trim() : "";
  if (publicReason.length < 20 || publicReason.length > 1000)
    throw new Error("A public outage reason of 20–1000 characters is required.");
  return {seconds, publicReason};
}

/** A fresh durable-job key per effective due time, so a completed job for an earlier time never suppresses it. */
export function deadlineJobKey(obligationId: string, effectiveDueAt: string): string {
  if (!obligationId) throw new Error("obligationId is required.");
  return `obligation:${obligationId}:deadline:${new Date(instant(effectiveDueAt, "effectiveDueAt")).toISOString()}`;
}

/**
 * The durable response clock of a direct invitation (migration 0034 mirrors this in SQL): it opens at
 * invitedReplyOpenedAt and lasts the debate's reply window. No provider evidence or no reply window → no clock.
 */
export function invitationResponseClock(debatePublishedAt: string, providerAcceptedAt: string | null, replyWindowHours: number | null): {openedAt: string; dueAt: string} | null {
  if (replyWindowHours === null) return null;
  if (!Number.isSafeInteger(replyWindowHours) || replyWindowHours <= 0) throw new Error("replyWindowHours must be a positive whole number.");
  const openedAt = invitedReplyOpenedAt(debatePublishedAt, providerAcceptedAt);
  if (openedAt === null) return null;
  return {openedAt, dueAt: new Date(Date.parse(openedAt) + replyWindowHours * 3600_000).toISOString()};
}
