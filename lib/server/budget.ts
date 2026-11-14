import "server-only";
import type {PoolClient} from "pg";
import {database} from "./db";
import {HttpError} from "./http";
import {manifestSeconds, parseBudget, renderBudgetDecision, storageBudgetDecision} from "../../packages/domain/budget.ts";

type Q = Pick<PoolClient, "query">;

/** Bytes of stored originals plus still-active upload reservations. Nothing is ever deleted to make room. */
export async function storageUsage(db: Q = database()) {
  const r = await db.query<{stored: string; reserved: string}>(
    `SELECT (SELECT COALESCE(sum(size_bytes),0) FROM media_assets)::text AS stored,
      (SELECT COALESCE(sum(declared_size_bytes),0) FROM media_upload_sessions WHERE status IN ('uploading','finalizing') AND expires_at>now())::text AS reserved`);
  return {storedBytes: Number(r.rows[0].stored), reservedBytes: Number(r.rows[0].reserved)};
}
export async function storageBudget(requestedBytes = 0, db: Q = database()) {
  const usage = await storageUsage(db);
  return storageBudgetDecision({budgetBytes: parseBudget(process.env.MEDIA_STORAGE_BUDGET_BYTES), ...usage, requestedBytes});
}
export async function requireStorageBudget(requestedBytes: number, db: Q = database()) {
  const budget = parseBudget(process.env.MEDIA_STORAGE_BUDGET_BYTES);
  if (budget === null) return;
  const d = await storageBudget(requestedBytes, db);
  if (!d.allowed) throw new HttpError(507, d.message!);
}

/** Output seconds rendered today (UTC) plus seconds already queued or running. */
export async function renderSecondsToday(db: Q = database(), excludeArtifactId: string | null = null) {
  const rendered = await db.query<{s: string}>(
    "SELECT COALESCE(sum(duration_seconds),0)::text AS s FROM derivative_artifacts WHERE rendered_at >= date_trunc('day', now() AT TIME ZONE 'UTC') AT TIME ZONE 'UTC'");
  const queued = await db.query<{source_manifest: {clips?: Array<{startSeconds: number; endSeconds: number}>}}>(
    `SELECT a.source_manifest FROM durable_jobs j JOIN derivative_artifacts a ON a.id::text=j.arguments->>'artifactId'
     WHERE j.job_type='render_debate_summary' AND j.state IN ('queued','running') AND ($1::uuid IS NULL OR a.id<>$1::uuid)`, [excludeArtifactId]);
  let pending = 0;
  for (const row of queued.rows) { try { pending += manifestSeconds(row.source_manifest?.clips ?? []); } catch {} }
  return Number(rendered.rows[0].s) + pending;
}
export async function renderBudget(requestedSeconds = 0, db: Q = database(), excludeArtifactId: string | null = null) {
  return renderBudgetDecision({budgetSecondsPerDay: parseBudget(process.env.RENDER_BUDGET_SECONDS_PER_DAY), usedSecondsToday: await renderSecondsToday(db, excludeArtifactId), requestedSeconds});
}
export async function requireRenderBudget(db: Q, requestedSeconds: number, artifactId: string) {
  if (parseBudget(process.env.RENDER_BUDGET_SECONDS_PER_DAY) === null) return;
  const d = await renderBudget(requestedSeconds, db, artifactId);
  if (!d.allowed) throw new HttpError(429, d.message!);
}
