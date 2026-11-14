import "server-only";
import {database} from "./db";
import {storageBudget,renderBudget} from "./budget";
import {emailProviderConfig} from "../../packages/delivery/email.ts";

/** PDE-29 monitors: queue backlog, failures, dead letters, scanner heartbeat, budgets. Admin-only; never public. */
export async function operationsSnapshot(){
 const db=database();
 const [jobs,jobErrors,outbox,dead,heartbeat,destinations,scheduled]=await Promise.all([
  db.query<{job_type:string;state:string;n:number;oldest_seconds:number|null}>(
   "SELECT job_type,state,count(*)::int AS n,extract(epoch FROM now()-min(CASE WHEN state IN ('queued','failed') AND available_at<=now() THEN available_at END))::int AS oldest_seconds FROM durable_jobs GROUP BY job_type,state ORDER BY job_type,state"),
  db.query<{id:string;job_type:string;attempt_count:number;last_error:string|null;available_at:string}>(
   "SELECT id,job_type,attempt_count,last_error,available_at FROM durable_jobs WHERE state='failed' ORDER BY available_at DESC LIMIT 20"),
  db.query<{action_type:string;state:string;n:number;oldest_seconds:number|null}>(
   "SELECT action_type,state,count(*)::int AS n,extract(epoch FROM now()-min(CASE WHEN state IN ('pending','failed') THEN created_at END))::int AS oldest_seconds FROM outgoing_actions GROUP BY action_type,state ORDER BY action_type,state"),
  db.query<{id:string;action_type:string;attempts:number;max_attempts:number;last_error:string|null;dead_at:string|null;destination_kind:string|null}>(
   "SELECT o.id,o.action_type,o.attempts,o.max_attempts,o.last_error,o.dead_at,d.kind AS destination_kind FROM outgoing_actions o LEFT JOIN delivery_destinations d ON d.id=o.destination_id WHERE o.state='dead' ORDER BY o.dead_at DESC NULLS LAST LIMIT 50"),
  db.query<{age_seconds:number}>("SELECT extract(epoch FROM now()-last_seen_at)::int AS age_seconds FROM media_scanner_heartbeat WHERE id=true"),
  db.query<{unverified:number;verified:number;disabled:number}>(
   "SELECT count(*) FILTER (WHERE verified_at IS NULL AND disabled_at IS NULL)::int AS unverified,count(*) FILTER (WHERE verified_at IS NOT NULL AND disabled_at IS NULL)::int AS verified,count(*) FILTER (WHERE disabled_at IS NOT NULL)::int AS disabled FROM delivery_destinations"),
  db.query<{last_run_at:string|null;runs_last_hour:number}>(
   "SELECT max(occurred_at) AS last_run_at,count(*) FILTER (WHERE occurred_at>now()-interval '1 hour')::int AS runs_last_hour FROM audit_events WHERE action='scheduled_operations_run'"),
 ]);
 const [storage,render]=await Promise.all([storageBudget(),renderBudget()]);
 const oldest=(rows:Array<{oldest_seconds:number|null}>)=>rows.reduce<number|null>((m,r)=>r.oldest_seconds===null?m:Math.max(m??0,r.oldest_seconds),null);
 return {
  generatedAt:new Date().toISOString(),
  jobs:{backlog:jobs.rows,oldestPendingSeconds:oldest(jobs.rows),recentFailures:jobErrors.rows},
  outbox:{backlog:outbox.rows,oldestPendingSeconds:oldest(outbox.rows),
   failedCount:outbox.rows.filter(r=>r.state==="failed").reduce((n,r)=>n+r.n,0),
   deadCount:outbox.rows.filter(r=>r.state==="dead").reduce((n,r)=>n+r.n,0),
   providerUnconfiguredCount:(await db.query<{n:number}>("SELECT count(*)::int AS n FROM outgoing_actions WHERE state='pending' AND last_error='provider_unconfigured'")).rows[0].n,
   deadLetters:dead.rows},
  scannerHeartbeatAgeSeconds:heartbeat.rows[0]?.age_seconds??null,
  scheduledRunner:{configured:(process.env.OPERATIONS_RUN_TOKEN?.length??0)>=64,lastRunAt:scheduled.rows[0]?.last_run_at??null,runsLastHour:scheduled.rows[0]?.runs_last_hour??0},
  storage:{usedBytes:storage.used,budgetBytes:storage.limit,remainingBytes:storage.remaining,newUploadsAllowed:storage.allowed},
  rendering:{usedSecondsToday:render.used,budgetSecondsPerDay:render.limit,optionalRendersAllowed:render.allowed},
  destinations:destinations.rows[0],
  emailProviderConfigured:Boolean(emailProviderConfig(process.env)),
  workerNote:"No always-on worker is presumed. Deadline jobs and deliveries run inline after requests, from the scheduled GitHub workflow (every 15 minutes when OPERATIONS_RUN_TOKEN is configured), via `npm run worker:outbox` / `npm run worker:deadlines`, or with Run pending jobs now."
 };
}
