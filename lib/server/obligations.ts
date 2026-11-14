import "server-only";
import type {PoolClient} from "pg";
import {enqueueObligationNotifications,nextDeadlineCheck} from "../../packages/delivery/outbox-store.ts";

type PublishedContinuation = {
  debateId: string;
  branchId: string;
  sourceSubmissionId: string;
  parentSubmissionId: string;
  publishingCandidacyId: string;
  obligatedCandidacyId: string;
  publishedAt: Date;
  replyWindowHours: number | null;
  opensReview: boolean;
  opensReply: boolean;
};

async function enqueueDeadline(db: PoolClient, obligation: {id: string; due_at: Date | null; opened_at: Date}) {
  if (!obligation.due_at) return;
  const dueAt = obligation.due_at.toISOString();
  // First check at the due-soon instant when the window exceeds 48 hours, otherwise at the deadline itself.
  const firstCheck = nextDeadlineCheck(obligation.opened_at, obligation.due_at, obligation.opened_at).nextAt;
  await db.query(
    "INSERT INTO durable_jobs(job_type,dedupe_key,arguments,available_at) VALUES('obligation_deadline',$1,$2::jsonb,$3) ON CONFLICT(job_type,dedupe_key) DO NOTHING",
    [`obligation:${obligation.id}:deadline:${dueAt}`, JSON.stringify({obligationId: obligation.id, effectiveDueAt: dueAt}), firstCheck],
  );
}

/**
 * Keep reply/review clocks in the same transaction as publication. Notices to the obligated candidate's own
 * verified destinations are only queued here (idempotently); delivery happens later in the outbox processor.
 */
export async function recordPublishedContinuationObligations(db: PoolClient, input: PublishedContinuation) {
  await db.query(
    "UPDATE reply_obligations SET received_at=COALESCE(received_at,$1),processed_at=COALESCE(processed_at,$1) WHERE source_submission_id=$2 AND obligated_candidacy_id=$3 AND obligation_type='reply'",
    [input.publishedAt, input.parentSubmissionId, input.publishingCandidacyId],
  );

  const dueAt = input.replyWindowHours === null
    ? null
    : new Date(input.publishedAt.getTime() + input.replyWindowHours * 60 * 60 * 1000);

  const opened: Array<{id: string; due_at: Date | null; opened_at: Date}> = [];
  if (input.opensReview) {
    const review = await db.query<{id: string; due_at: Date | null; opened_at: Date}>(
      "INSERT INTO reply_obligations(debate_id,branch_id,source_submission_id,obligated_candidacy_id,obligation_type,opened_at,due_at) VALUES($1,$2,$3,$4,'review',$5,$6) ON CONFLICT(branch_id,source_submission_id,obligated_candidacy_id,obligation_type) DO NOTHING RETURNING id,due_at,opened_at",
      [input.debateId, input.branchId, input.sourceSubmissionId, input.obligatedCandidacyId, input.publishedAt, dueAt],
    );
    opened.push(...review.rows);
  }
  if (input.opensReply) {
    const reply = await db.query<{id: string; due_at: Date | null; opened_at: Date}>(
      "INSERT INTO reply_obligations(debate_id,branch_id,source_submission_id,obligated_candidacy_id,obligation_type,opened_at,due_at) VALUES($1,$2,$3,$4,'reply',$5,$6) ON CONFLICT(branch_id,source_submission_id,obligated_candidacy_id,obligation_type) DO NOTHING RETURNING id,due_at,opened_at",
      [input.debateId, input.branchId, input.sourceSubmissionId, input.obligatedCandidacyId, input.publishedAt, dueAt],
    );
    opened.push(...reply.rows);
  }
  for (const obligation of opened) {
    await enqueueDeadline(db, obligation);
    await enqueueObligationNotifications(db, {obligationId: obligation.id, phase: "opened"});
  }
}

export async function fulfillReviewObligation(
  db: PoolClient,
  input: {sourceSubmissionId: string; obligatedCandidacyId: string},
) {
  await db.query(
    "UPDATE reply_obligations SET received_at=COALESCE(received_at,now()),processed_at=COALESCE(processed_at,now()) WHERE source_submission_id=$1 AND obligated_candidacy_id=$2 AND obligation_type='review'",
    [input.sourceSubmissionId, input.obligatedCandidacyId],
  );
}
