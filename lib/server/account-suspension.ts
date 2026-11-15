import "server-only";
import {database,transaction} from "./db";
import {HttpError} from "./http";
import {RestrictionRuleError,configuredAdminCount,decisionIndependence} from "../../packages/domain/restrictions";
import {readReinstatement,readSuspension,suspensionTransition} from "../../packages/domain/suspension";

function rule<T>(fn:()=>T):T{
 try{return fn();}catch(e){if(e instanceof RestrictionRuleError)throw new HttpError(400,e.message);throw e;}
}

/** A platform administrator suspends another account. requireAdmin() is enforced by the route. */
export async function suspendAccount(adminAccountId:string,accountId:string,input:Record<string,unknown>){
 const s=rule(()=>readSuspension(input));
 return transaction(async db=>{
  const a=await db.query<{status:string}>("SELECT status FROM accounts WHERE id=$1 FOR UPDATE",[accountId]);
  if(!a.rowCount)throw new HttpError(404,"Account not found.");
  const t=suspensionTransition("suspend",a.rows[0].status,accountId===adminAccountId);
  if(!t.ok)throw new HttpError(t.code,t.message);
  await db.query("UPDATE accounts SET status='suspended' WHERE id=$1",[accountId]);
  const e=await db.query<{id:string;occurred_at:string}>(
   "INSERT INTO account_suspension_events(account_id,event_type,reason_category,public_notice,private_basis,actor_account_id) VALUES($1,'suspended',$2,$3,$4,$5) RETURNING id,occurred_at",
   [accountId,s.reasonCategory,s.publicNotice,s.privateBasis,adminAccountId]);
  await db.query("INSERT INTO audit_events(actor_account_id,action,target_kind,target_id,context) VALUES($1,'account_suspended','account',$2,$3::jsonb)",
   [adminAccountId,accountId,JSON.stringify({eventId:e.rows[0].id,reasonCategory:s.reasonCategory})]);
  return {accountId,status:"suspended" as const,eventId:e.rows[0].id,suspendedAt:e.rows[0].occurred_at,publicRecordPreserved:true};
 });
}

/** Reinstatement. With more than one configured administrator, the one who suspended may not reinstate. */
export async function reinstateAccount(adminAccountId:string,accountId:string,input:Record<string,unknown>){
 const r=rule(()=>readReinstatement(input));
 return transaction(async db=>{
  const a=await db.query<{status:string}>("SELECT status FROM accounts WHERE id=$1 FOR UPDATE",[accountId]);
  if(!a.rowCount)throw new HttpError(404,"Account not found.");
  const t=suspensionTransition("reinstate",a.rows[0].status,accountId===adminAccountId);
  if(!t.ok)throw new HttpError(t.code,t.message);
  const last=await db.query<{actor_account_id:string;reason_category:string}>(
   "SELECT actor_account_id,reason_category FROM account_suspension_events WHERE account_id=$1 AND event_type='suspended' ORDER BY occurred_at DESC,id DESC LIMIT 1",[accountId]);
  const opener=last.rows[0]?.actor_account_id??adminAccountId;
  const independence=decisionIndependence(opener,adminAccountId,configuredAdminCount(process.env.PLATFORM_ADMIN_USER_IDS));
  if(!independence.permitted)throw new HttpError(403,"A different administrator must reinstate an account you suspended.");
  await db.query("UPDATE accounts SET status='active' WHERE id=$1",[accountId]);
  const e=await db.query<{id:string;occurred_at:string}>(
   "INSERT INTO account_suspension_events(account_id,event_type,reason_category,public_notice,private_basis,actor_account_id,independent_review) VALUES($1,'reinstated',$2,$3,$4,$5,$6) RETURNING id,occurred_at",
   [accountId,last.rows[0]?.reason_category??"malware_or_security",r.publicNotice,r.privateBasis,adminAccountId,independence.independentReview]);
  await db.query("INSERT INTO audit_events(actor_account_id,action,target_kind,target_id,context) VALUES($1,'account_reinstated','account',$2,$3::jsonb)",
   [adminAccountId,accountId,JSON.stringify({eventId:e.rows[0].id,independentReview:independence.independentReview})]);
  return {accountId,status:"active" as const,eventId:e.rows[0].id,independentReview:independence.independentReview};
 });
}

/** Administrators only: accounts that are or were suspended, with their full history. */
export async function listSuspensionsAdmin(){
 const q=await database().query<{account_id:string;display_name:string;status:string;events:unknown}>(
  `SELECT a.id AS account_id,a.display_name,a.status,
    json_agg(json_build_object('id',e.id,'eventType',e.event_type,'reasonCategory',e.reason_category,'publicNotice',e.public_notice,
     'privateBasis',e.private_basis,'independentReview',e.independent_review,'occurredAt',e.occurred_at) ORDER BY e.occurred_at,e.id) AS events
   FROM account_suspension_events e JOIN accounts a ON a.id=e.account_id GROUP BY a.id ORDER BY max(e.occurred_at) DESC LIMIT 200`);
 return q.rows;
}

/** Public notice for a suspended account, shown with its public profile; the private basis is never public. */
export async function publicSuspensionNotice(accountId:string){
 const q=await database().query<{public_notice:string;reason_category:string;occurred_at:string}>(
  `SELECT e.public_notice,e.reason_category,e.occurred_at FROM account_suspension_events e JOIN accounts a ON a.id=e.account_id
   WHERE e.account_id=$1 AND e.event_type='suspended' AND a.status='suspended' ORDER BY e.occurred_at DESC,e.id DESC LIMIT 1`,[accountId]);
 return q.rows[0]??null;
}
