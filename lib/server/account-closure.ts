import "server-only";
import {transaction} from "./db";
import {HttpError} from "./http";
import {erasePrivateDraftRecord} from "./private-retention";
import {ACCOUNT_CLOSURE_CONFIRMATION,WITHDRAWAL_CONFIRMATION,RestrictionRuleError,readWithdrawalStatement} from "../../packages/domain/restrictions";

/**
 * Closes the caller's account. Published contributions, questions, assessments,
 * agreements and candidacy snapshots stay attributed and public; private drafts
 * and private assistant data are erased with the existing erasure core.
 */
export async function closeAccount(authSubject:string,confirmation:unknown){
 if(confirmation!==ACCOUNT_CLOSURE_CONFIRMATION)throw new HttpError(400,"Type "+ACCOUNT_CLOSURE_CONFIRMATION+" exactly to confirm account closure.");
 return transaction(async db=>{
  const account=await db.query<{id:string;status:string}>("SELECT id,status FROM accounts WHERE identity_provider='neon-auth' AND external_subject=$1 FOR UPDATE",[authSubject]);
  if(!account.rowCount)throw new HttpError(404,"Account not found.");
  if(account.rows[0].status!=="active")throw new HttpError(409,"This account is already closed or suspended.");
  const id=account.rows[0].id;
  const drafts=await db.query<{id:string;status:string;privacy_erased_at:Date|null}>(
   "SELECT id,status,privacy_erased_at FROM private_submission_drafts WHERE owner_account_id=$1 ORDER BY created_at FOR UPDATE",[id]);
  let deleted=0,scrubbed=0;
  for(const draft of drafts.rows){
   const r=await erasePrivateDraftRecord(db,draft);
   if(!r.alreadyErased){if(r.publishedOriginalPreserved)scrubbed++;else deleted++;}
  }
  const feedback=await db.query("DELETE FROM private_assessment_feedback WHERE owner_account_id=$1",[id]);
  const reports=await db.query("DELETE FROM private_debate_assessments WHERE owner_account_id=$1",[id]);
  // Roles this account holds, and delegated roles on candidacies it owns.
  const memberships=await db.query(
   "UPDATE campaign_memberships SET revoked_at=now() WHERE revoked_at IS NULL AND (account_id=$1 OR (role<>'candidate' AND candidacy_id IN (SELECT c.id FROM candidacies c WHERE c.account_id=$1)))",[id]);
  await db.query("UPDATE accounts SET status='closed' WHERE id=$1",[id]);
  const context={unpublishedDraftsDeleted:deleted,publishedDraftsScrubbed:scrubbed,privateReportsDeleted:reports.rowCount,feedbackDeleted:feedback.rowCount,membershipsRevoked:memberships.rowCount};
  await db.query("INSERT INTO audit_events(actor_account_id,action,target_kind,target_id,context) VALUES($1,'account_closed','account',$1,$2::jsonb)",[id,JSON.stringify(context)]);
  return {status:"closed" as const,...context,publicRecordPreserved:true};
 });
}

/** A candidacy owner withdraws from the election. Historic records stay attributed. */
export async function withdrawCandidacy(candidacyId:string,authSubject:string,input:{confirmation:unknown;statement:unknown}){
 if(input.confirmation!==WITHDRAWAL_CONFIRMATION)throw new HttpError(400,"Type "+WITHDRAWAL_CONFIRMATION+" exactly to confirm withdrawal.");
 let statement:string|null;
 try{statement=readWithdrawalStatement(input.statement);}catch(e){if(e instanceof RestrictionRuleError)throw new HttpError(400,e.message);throw e;}
 return transaction(async db=>{
  const owner=await db.query<{account_id:string}>(
   "SELECT c.account_id FROM candidacies c JOIN accounts a ON a.id=c.account_id WHERE c.id=$1 AND a.identity_provider='neon-auth' AND a.external_subject=$2 AND a.status='active' FOR UPDATE OF c",[candidacyId,authSubject]);
  if(!owner.rowCount)throw new HttpError(403,"Only the active account owning this candidacy may withdraw it.");
  if((await db.query("SELECT 1 FROM candidacy_status_events WHERE candidacy_id=$1 AND event_type='withdrawn'",[candidacyId])).rowCount)
   throw new HttpError(409,"This candidacy has already withdrawn.");
  const event=await db.query<{id:string;occurred_at:string}>(
   "INSERT INTO candidacy_status_events(candidacy_id,event_type,actor_account_id,public_statement) VALUES($1,'withdrawn',$2,$3) RETURNING id,occurred_at",[candidacyId,owner.rows[0].account_id,statement]);
  await db.query("INSERT INTO audit_events(actor_account_id,action,target_kind,target_id,context) VALUES($1,'candidacy_withdrawn','candidacy',$2,$3::jsonb)",[owner.rows[0].account_id,candidacyId,JSON.stringify({eventId:event.rows[0].id})]);
  return {candidacyId,withdrawnAt:event.rows[0].occurred_at,publicStatement:statement};
 });
}
