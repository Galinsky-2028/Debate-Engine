import "server-only";
import {NextResponse} from "next/server";
import type {PoolClient} from "pg";
import {database,transaction} from "./db";
import {HttpError} from "./http";
import {
 APPEAL_PUBLIC_NOTICE,RestrictionRuleError,configuredAdminCount,decisionIndependence,noticeRepeatsMaterial,
 readAppealStatement,readCategory,readDecision,readPrivateBasis,readPublicNotice,readTargetKind,
 restrictionCategoryLabels,type RestrictionCategory
} from "../../packages/domain/restrictions";
import {PUBLIC_RESTRICTION_HISTORY_SQL,ACTIVE_PUBLIC_RESTRICTION_SQL} from "../../packages/domain/restriction-queries";

export type PublicRestriction={caseId:string;targetKind:string;inherited:boolean;category:RestrictionCategory;
 openedAt:string;publicNotice:string;appealStatus:"none"|"pending"|"upheld"};

function rule<T>(fn:()=>T):T{
 try{return fn();}catch(e){if(e instanceof RestrictionRuleError)throw new HttpError(400,e.message);throw e;}
}
function dbRule(e:unknown):never{
 const err=e as {code?:string;message?:string};
 if(err&&err.code==="23505")throw new HttpError(409,"This item already has an active restriction case.");
 if(err&&err.code==="23514"&&typeof err.message==="string")throw new HttpError(403,err.message);
 throw e;
}
async function accountIdFor(db:PoolClient,subject:string){
 const q=await db.query<{id:string}>("SELECT id FROM accounts WHERE identity_provider='neon-auth' AND external_subject=$1 AND status='active'",[subject]);
 if(!q.rowCount)throw new HttpError(403,"An active platform account is required.");
 return q.rows[0].id;
}

/** Platform safety administrator opens a case. requireAdmin() is enforced by the route. */
export async function openRestriction(adminAccountId:string,input:Record<string,unknown>){
 const targetKind=rule(()=>readTargetKind(input.targetKind));
 const category=rule(()=>readCategory(input.reasonCategory));
 const publicNotice=rule(()=>readPublicNotice(input.publicNotice));
 const privateBasis=rule(()=>readPrivateBasis(input.privateBasis));
 const targetId=String(input.targetId||"");
 return transaction(async db=>{
  const target=await db.query<{debate_id:string|null;branch_id:string|null;material:string|null}>(
   `SELECT pde_restriction_target_debate($1,$2::uuid) AS debate_id,
     CASE $1 WHEN 'submission' THEN (SELECT branch_id FROM submissions WHERE id=$2::uuid)
      WHEN 'derivative' THEN (SELECT branch_id FROM derivative_artifacts WHERE id=$2::uuid)
      ELSE (SELECT s.branch_id FROM submission_documents doc JOIN submissions s ON s.id=doc.submission_id WHERE doc.id=$2::uuid) END AS branch_id,
     CASE $1 WHEN 'submission' THEN (SELECT concat_ws(' ',s.written_content,(SELECT string_agg(mc.searchable_text,' ') FROM media_captions mc WHERE mc.media_asset_id=s.media_asset_id)) FROM submissions s WHERE s.id=$2::uuid)
      WHEN 'document' THEN (SELECT concat_ws(' ',doc.label,doc.filename) FROM submission_documents doc WHERE doc.id=$2::uuid)
      ELSE (SELECT a.source_manifest->>'captions' FROM derivative_artifacts a WHERE a.id=$2::uuid) END AS material`,[targetKind,targetId]);
  const t=target.rows[0];
  if(!t?.debate_id)throw new HttpError(404,"Only a published submission, supporting document or released derivative can be restricted.");
  if(noticeRepeatsMaterial(publicNotice,[t.material,privateBasis]))
   throw new HttpError(400,"The public notice must describe the restriction without repeating the restricted material or private basis.");
  let caseId:string;
  try{
   await db.query("SAVEPOINT open_case");
   caseId=(await db.query<{id:string}>("INSERT INTO restriction_cases(target_kind,target_id,debate_id,reason_category,opened_by_account_id) VALUES($1,$2,$3,$4,$5) RETURNING id",
    [targetKind,targetId,t.debate_id,category,adminAccountId])).rows[0].id;
   await db.query("INSERT INTO restriction_events(case_id,event_order,event_type,actor_account_id,public_notice,private_basis) VALUES($1,1,'opened',$2,$3,$4)",
    [caseId,adminAccountId,publicNotice,privateBasis]);
  }catch(e){await db.query("ROLLBACK TO SAVEPOINT open_case");dbRule(e);}
  await db.query("INSERT INTO publication_events(debate_id,branch_id,kind,object_id,payload) VALUES($1,$2,'restriction_opened',$3,$4::jsonb)",
   [t.debate_id,t.branch_id,caseId,JSON.stringify({caseId,targetKind,targetId,reasonCategory:category,publicNotice})]);
  await db.query("INSERT INTO audit_events(actor_account_id,action,target_kind,target_id,context) VALUES($1,'restriction_opened','restriction_case',$2,$3::jsonb)",
   [adminAccountId,caseId,JSON.stringify({targetKind,targetId,reasonCategory:category})]);
  return {caseId,status:"active" as const};
 });
}

/** Only the contributor whose published item is restricted may appeal. */
export async function appealRestriction(caseId:string,authSubject:string,statementRaw:unknown){
 const statement=rule(()=>readAppealStatement(statementRaw));
 return transaction(async db=>{
  const actor=await accountIdFor(db,authSubject);
  const c=await db.query<{debate_id:string;target_kind:string;target_id:string;status:string;owns:boolean}>(
   "SELECT rc.debate_id,rc.target_kind,rc.target_id,rc.status,EXISTS(SELECT 1 FROM pde_restriction_target_owner_accounts(rc.target_kind,rc.target_id) o WHERE o=$2) AS owns FROM restriction_cases rc WHERE rc.id=$1 FOR UPDATE",[caseId,actor]);
  if(!c.rowCount)throw new HttpError(404,"Restriction case not found.");
  if(!c.rows[0].owns)throw new HttpError(403,"Only the contributor whose item is restricted may appeal.");
  if(c.rows[0].status!=="active")throw new HttpError(409,"This restriction has been lifted.");
  try{
   await db.query("SAVEPOINT appeal");
   await db.query("INSERT INTO restriction_events(case_id,event_order,event_type,actor_account_id,public_notice,private_basis) VALUES($1,1,'appealed',$2,$3,$4)",[caseId,actor,APPEAL_PUBLIC_NOTICE,statement]);
  }catch(e){await db.query("ROLLBACK TO SAVEPOINT appeal");const err=e as {message?:string};if(String(err?.message).includes("already pending"))throw new HttpError(409,"An appeal is already pending.");dbRule(e);}
  await db.query("INSERT INTO publication_events(debate_id,kind,object_id,payload) VALUES($1,'restriction_appealed',$2,$3::jsonb)",[c.rows[0].debate_id,caseId,JSON.stringify({caseId,publicNotice:APPEAL_PUBLIC_NOTICE})]);
  await db.query("INSERT INTO audit_events(actor_account_id,action,target_kind,target_id) VALUES($1,'restriction_appealed','restriction_case',$2)",[actor,caseId]);
  return {caseId,appealStatus:"pending" as const};
 });
}

/** Uphold a pending appeal or lift the case. Independence is recorded truthfully. */
export async function decideAppeal(caseId:string,adminAccountId:string,input:Record<string,unknown>){
 const decision=rule(()=>readDecision(input.decision));
 const publicNotice=rule(()=>readPublicNotice(input.publicReason));
 const privateBasis=rule(()=>readPrivateBasis(input.privateBasis));
 return transaction(async db=>{
  const c=await db.query<{debate_id:string;opened_by_account_id:string;status:string;last:string}>(
   "SELECT rc.debate_id,rc.opened_by_account_id,rc.status,(SELECT e.event_type FROM restriction_events e WHERE e.case_id=rc.id ORDER BY e.event_order DESC LIMIT 1) AS last FROM restriction_cases rc WHERE rc.id=$1 FOR UPDATE",[caseId]);
  if(!c.rowCount)throw new HttpError(404,"Restriction case not found.");
  const row=c.rows[0];
  if(row.status!=="active")throw new HttpError(409,"This restriction has already been lifted.");
  if(decision==="uphold"&&row.last!=="appealed")throw new HttpError(409,"Only a pending appeal can be upheld.");
  const independence=decisionIndependence(row.opened_by_account_id,adminAccountId,configuredAdminCount(process.env.PLATFORM_ADMIN_USER_IDS));
  if(!independence.permitted)throw new HttpError(403,"Another platform administrator must decide a case you opened.");
  const eventType=decision==="uphold"?"upheld":"lifted";
  try{
   await db.query("SAVEPOINT decide");
   await db.query("INSERT INTO restriction_events(case_id,event_order,event_type,actor_account_id,public_notice,private_basis,independent_review) VALUES($1,1,$2,$3,$4,$5,$6)",
    [caseId,eventType,adminAccountId,publicNotice,privateBasis,independence.independentReview]);
   if(eventType==="lifted")await db.query("UPDATE restriction_cases SET status='lifted' WHERE id=$1",[caseId]);
  }catch(e){await db.query("ROLLBACK TO SAVEPOINT decide");dbRule(e);}
  await db.query("INSERT INTO publication_events(debate_id,kind,object_id,payload) VALUES($1,$2,$3,$4::jsonb)",
   [row.debate_id,"restriction_"+eventType,caseId,JSON.stringify({caseId,publicNotice,independentReview:independence.independentReview})]);
  await db.query("INSERT INTO audit_events(actor_account_id,action,target_kind,target_id,context) VALUES($1,$2,'restriction_case',$3,$4::jsonb)",
   [adminAccountId,"restriction_"+eventType,caseId,JSON.stringify({independentReview:independence.independentReview})]);
  return {caseId,status:eventType==="lifted"?"lifted":"active",independentReview:independence.independentReview};
 });
}

/** Administrator view, including private basis. Never use for public output. */
export async function listRestrictionsAdmin(){
 const cases=await database().query(
  "SELECT rc.id,rc.target_kind,rc.target_id,rc.debate_id,d.title AS debate_title,rc.reason_category,rc.status,rc.opened_by_account_id,rc.opened_at FROM restriction_cases rc JOIN debates d ON d.id=rc.debate_id ORDER BY (rc.status='active') DESC,rc.opened_at DESC LIMIT 200");
 const ids=cases.rows.map(c=>c.id);
 const events=ids.length?await database().query(
  "SELECT id,case_id,event_order,event_type,actor_account_id,public_notice,private_basis,independent_review,occurred_at FROM restriction_events WHERE case_id=ANY($1::uuid[]) ORDER BY case_id,event_order",[ids]):{rows:[]};
 return cases.rows.map(c=>({...c,events:events.rows.filter(e=>e.case_id===c.id)}));
}

/** Public history: categories, notices, event types, timestamps, independence. */
export async function publicRestrictions(debateId:string){
 const q=await database().query<{case_id:string;target_kind:string;target_id:string;reason_category:RestrictionCategory;status:string;opened_at:string;events:Array<{eventType:string;publicNotice:string;independentReview:boolean;occurredAt:string}>}>(PUBLIC_RESTRICTION_HISTORY_SQL,[debateId]);
 return q.rows.map(r=>({caseId:r.case_id,targetKind:r.target_kind,targetId:r.target_id,category:r.reason_category,
  categoryLabel:restrictionCategoryLabels[r.reason_category],status:r.status,openedAt:r.opened_at,events:r.events}));
}

/** Active restriction affecting the item ('media' resolves to its submission). */
export async function activeRestriction(kind:"submission"|"media"|"document"|"derivative",id:string){
 const q=await database().query<{restriction:PublicRestriction|null}>(ACTIVE_PUBLIC_RESTRICTION_SQL,[kind,id]);
 return q.rows[0]?.restriction??null;
}
export function restrictedResponse(r:PublicRestriction){
 return NextResponse.json({error:"This item is withheld under an exceptional platform restriction. Its existence and attribution remain in the public record.",
  restriction:{...r,categoryLabel:restrictionCategoryLabels[r.category]}},
  {status:451,headers:{"Cache-Control":"no-store","X-Content-Type-Options":"nosniff"}});
}
