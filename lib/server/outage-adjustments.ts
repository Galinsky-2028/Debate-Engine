// Transaction core for administrator outage extensions (PDE-14). No "server-only" import so the DB
// integration tests exercise this code; the admin route calls it inside transaction(...).
import type {PoolClient} from "pg";
import {HttpError} from "./http-error.ts";
import {parseOutageExtension,deadlineJobKey} from "../../packages/domain/deadlines.ts";

type Db=Pick<PoolClient,"query">;

/**
 * Append a visible, immutable extension to an open or overdue obligation and enqueue a fresh
 * deadline job for the new effective due time (a new dedupe key, so an already-completed job for
 * the earlier due time cannot suppress it). Fulfilled obligations are not retroactively re-labelled.
 */
export async function extendObligationForOutage(db:Db,input:{obligationId:string;adminAccountId:string;seconds:unknown;publicReason:unknown}){
 let parsed;
 try{parsed=parseOutageExtension(input)}catch(e){throw new HttpError(400,(e as Error).message)}
 const found=await db.query<{id:string;debate_id:string;branch_id:string;obligation_type:string;obligated_candidacy_id:string;due_at:Date|null;received_at:Date|null}>(
  "SELECT id,debate_id,branch_id,obligation_type,obligated_candidacy_id,due_at,received_at FROM reply_obligations WHERE id=$1 FOR UPDATE",[input.obligationId]);
 const o=found.rows[0];
 if(!o)throw new HttpError(404,"Obligation not found.");
 if(o.received_at)throw new HttpError(409,"This obligation was already fulfilled; its recorded timeliness is not changed retroactively.");
 if(!o.due_at)throw new HttpError(409,"This obligation has no fixed deadline to extend.");
 const made=await db.query<{id:string;created_at:Date}>(
  "INSERT INTO obligation_outage_adjustments(obligation_id,seconds,public_reason,authorized_by) VALUES($1,$2,$3,$4) RETURNING id,created_at",
  [o.id,parsed.seconds,parsed.publicReason,input.adminAccountId]);
 const due=await db.query<{effective_due_at:Date;total:number}>(
  "SELECT $2::timestamptz+COALESCE(sum(seconds),0)*interval '1 second' AS effective_due_at,COALESCE(sum(seconds),0)::integer AS total FROM obligation_outage_adjustments WHERE obligation_id=$1",[o.id,o.due_at]);
 const effectiveDueAt=due.rows[0].effective_due_at.toISOString();
 const job=await db.query<{id:string}>(
  "INSERT INTO durable_jobs(job_type,dedupe_key,arguments,available_at) VALUES('obligation_deadline',$1,$2::jsonb,$3) ON CONFLICT(job_type,dedupe_key) DO NOTHING RETURNING id",
  [deadlineJobKey(o.id,effectiveDueAt),JSON.stringify({obligationId:o.id,effectiveDueAt}),effectiveDueAt]);
 const adjustmentId=made.rows[0].id;
 await db.query("INSERT INTO publication_events(debate_id,branch_id,kind,object_id,payload) VALUES($1,$2,'obligation_deadline_extended',$3,$4::jsonb)",
  [o.debate_id,o.branch_id,o.id,JSON.stringify({adjustmentId,obligationType:o.obligation_type,obligatedCandidacyId:o.obligated_candidacy_id,seconds:parsed.seconds,totalExtensionSeconds:due.rows[0].total,publicReason:parsed.publicReason,effectiveDueAt})]);
 await db.query("INSERT INTO audit_events(actor_account_id,action,target_kind,target_id,context) VALUES($1,'obligation_outage_extension','reply_obligation',$2,$3::jsonb)",
  [input.adminAccountId,o.id,JSON.stringify({adjustmentId,seconds:parsed.seconds})]);
 return {adjustmentId,obligationId:o.id,seconds:parsed.seconds,effectiveDueAt,deadlineJobId:job.rows[0]?.id||null};
}

/** Open and overdue obligations with their effective (outage-extended) due time, for administrators. */
export async function listUnfulfilledObligations(db:Db){
 const result=await db.query(`WITH projected AS (
   SELECT ro.*,ro.due_at+COALESCE(sum(oa.seconds),0)*interval '1 second' AS effective_due_at,COALESCE(sum(oa.seconds),0)::integer AS extension_seconds
   FROM reply_obligations ro LEFT JOIN obligation_outage_adjustments oa ON oa.obligation_id=ro.id WHERE ro.received_at IS NULL GROUP BY ro.id)
  SELECT p.id,p.debate_id,d.title AS debate_title,p.branch_id,p.obligation_type,c.public_name AS obligated_candidate,p.opened_at,p.due_at,p.effective_due_at,p.extension_seconds,
   CASE WHEN p.effective_due_at IS NOT NULL AND now()>p.effective_due_at THEN 'overdue' ELSE 'open' END AS state
  FROM projected p JOIN debates d ON d.id=p.debate_id JOIN candidacies c ON c.id=p.obligated_candidacy_id
  ORDER BY p.effective_due_at NULLS LAST,p.opened_at LIMIT 200`);
 return result.rows;
}
