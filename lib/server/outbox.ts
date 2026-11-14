import "server-only";
import {after} from "next/server";
import {database} from "./db";
import {processOutbox, retryDeadLetter, type OutboxRunSummary} from "../../packages/delivery/outbox-store.ts";
import {runDeadlineJobs} from "../../scripts/deadline-worker.mjs";
import {deliveryLabel, DELIVERY_LABEL_TEXT, type OutboxState} from "../../packages/domain/outbox.ts";

export {processOutbox, retryDeadLetter};

/**
 * The free web service has no background worker: after a request enqueues delivery work, process a small bounded
 * batch once the response has been sent. Failures stay recorded in the outbox; they never fail the request.
 */
export function scheduleOutboxRun(limit = 5) {
  after(async () => {
    try { await processOutbox(database(), {limit}); }
    catch (error) { console.error("Inline outbox run failed", error instanceof Error ? error.name : "unknown"); }
  });
}

/** One bounded batch of deadline jobs followed by one bounded outbox batch (admin "Run pending jobs now"). */
export async function runPendingOperations(limit = 25): Promise<{deadlineJobs: number; deadlineError: string | null; outbox: OutboxRunSummary | null; outboxError: string | null}> {
  let deadlineJobs = 0, deadlineError: string | null = null, outbox: OutboxRunSummary | null = null, outboxError: string | null = null;
  try { deadlineJobs = await runDeadlineJobs(database(), limit); }
  catch (error) { deadlineError = error instanceof Error ? error.message.slice(0, 300) : "Deadline batch failed."; }
  try { outbox = await processOutbox(database(), {limit}); }
  catch (error) { outboxError = error instanceof Error ? error.message.slice(0, 300) : "Outbox batch failed."; }
  return {deadlineJobs, deadlineError, outbox, outboxError};
}

export type DeliveryRow = {
  id: string; action_type: string; state: OutboxState; attempts: number; max_attempts: number; last_error: string | null;
  created_at: string; last_attempt_at: string | null; accepted_at: string | null; delivered_at: string | null; next_attempt_at: string;
  destination_id: string; destination_label: string; destination_kind: string; subject_kind: string | null; subject_id: string | null;
};
export function labelled(row: DeliveryRow) {
  const label = deliveryLabel({state: row.state, attempts: row.attempts, maxAttempts: row.max_attempts, lastError: row.last_error});
  const waitingForProvider = row.state === "pending" && row.last_error === "provider_unconfigured";
  return {...row, label, labelText: waitingForProvider ? "Queued — not sent (no email provider configured)" : DELIVERY_LABEL_TEXT[label]};
}
