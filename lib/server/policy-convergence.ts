import "server-only";
import { transaction } from "./db";
import { HttpError } from "./http";
import { policyHash, policyManifestDigest, validatePolicyManifest, normalizePolicyText, type PolicyScope } from "../../packages/domain/policy";
export { policyHash };
import { policyAcceptanceEventKind } from "../../packages/domain/policy-view";
async function participant(db:import("pg").PoolClient,branchId:string,candidateId:string,authSubject:string){
 const r=await db.query<{debate_id:string;originator_candidacy_id:string;responder_candidacy_id:string;account_id:string}>(
  "SELECT d.id AS debate_id,d.originator_candidacy_id,b.responder_candidacy_id,c.account_id FROM debate_branches b JOIN debates d ON d.id=b.debate_id JOIN candidacies c ON c.id=$2 AND c.verification_status='verified' JOIN accounts a ON a.id=c.account_id WHERE b.id=$1 AND a.identity_provider='neon-auth' AND a.external_subject=$3 AND c.id IN(d.originator_candidacy_id,b.responder_candidacy_id) FOR UPDATE OF b",
  [branchId,candidateId,authSubject]);
 if(!r.rowCount)throw new HttpError(403,"Only a verified participant in this debate branch may act.");
 return r.rows[0];
}
export type PolicyProposalInput={branchId:string;candidateId:string;authSubject:string;body:string;parentVersionId:string|null;
 scope?:PolicyScope;addressedQuestionIds?:string[];changesSummary?:string;remainingDisagreements?:string;attachmentDocumentIds?:string[]};
export async function proposePolicy(input:PolicyProposalInput){
 const normalized=normalizePolicyText(input.body).trim();
 const scope=input.scope||"full";
 const addressedQuestionIds=(input.addressedQuestionIds||[]).map(x=>x.toLowerCase());
 const attachmentDocumentIds=(input.attachmentDocumentIds||[]).map(x=>x.toLowerCase());
 const changesSummary=normalizePolicyText(input.changesSummary||"").trim();
 const remainingDisagreements=normalizePolicyText(input.remainingDisagreements||"").trim();
 if(new Set(attachmentDocumentIds).size!==attachmentDocumentIds.length)throw new HttpError(400,"A supporting document may be attached only once.");
 if(attachmentDocumentIds.length>20)throw new HttpError(400,"At most 20 supporting documents may be attached.");
 return transaction(async db=>{
  const member=await participant(db,input.branchId,input.candidateId,input.authSubject);
  if(input.parentVersionId){
   const parent=await db.query("SELECT 1 FROM policy_versions WHERE id=$1 AND branch_id=$2",[input.parentVersionId,input.branchId]);
   if(!parent.rowCount)throw new HttpError(400,"Parent policy version belongs to another branch or does not exist.");
  }
  if(addressedQuestionIds.length){
   const found=await db.query("SELECT q.id FROM questions q JOIN submissions s ON s.id=q.submission_id WHERE q.id=ANY($1::uuid[]) AND s.debate_id=$2 AND s.published_at IS NOT NULL AND (s.branch_id=$3 OR s.kind='opening')",
    [addressedQuestionIds,member.debate_id,input.branchId]);
   if(found.rowCount!==new Set(addressedQuestionIds).size)throw new HttpError(400,"Addressed questions must be published questions from this branch or the opening presentation.");
  }
  let attachmentSha256:string[]=[];
  if(attachmentDocumentIds.length){
   const docs=await db.query<{id:string;sha256:string}>("SELECT x.id,x.sha256 FROM submission_documents x JOIN submissions s ON s.id=x.submission_id WHERE x.id=ANY($1::uuid[]) AND s.debate_id=$2 AND s.published_at IS NOT NULL",
    [attachmentDocumentIds,member.debate_id]);
   if(docs.rowCount!==attachmentDocumentIds.length)throw new HttpError(400,"Attachments must be published supporting documents of this debate.");
   attachmentSha256=docs.rows.map(x=>x.sha256);
  }
  const manifest={body:normalized,scope,addressedQuestionIds,changesSummary,remainingDisagreements,attachmentSha256};
  const problems=validatePolicyManifest(manifest);
  if(problems.length)throw new HttpError(400,problems[0]);
  const digest=policyManifestDigest(manifest);
  const row=await db.query<{id:string}>("INSERT INTO policy_versions(branch_id,proposed_by_candidacy_id,content_sha256,policy_body,parent_version_id,scope,addressed_question_ids,changes_summary,remaining_disagreements,attachment_document_ids) VALUES($1,$2,$3,$4,$5,$6,$7::uuid[],$8,$9,$10::uuid[]) RETURNING id",
   [input.branchId,input.candidateId,digest,normalized,input.parentVersionId,scope,addressedQuestionIds,changesSummary,remainingDisagreements,attachmentDocumentIds]);
  await db.query("INSERT INTO publication_events(debate_id,branch_id,actor_candidacy_id,kind,object_id,payload) VALUES($1,$2,$3,'policy_version_proposed',$4,$5::jsonb)",[member.debate_id,input.branchId,input.candidateId,row.rows[0].id,JSON.stringify({contentSha256:digest,parentVersionId:input.parentVersionId,scope,addressedQuestionIds,attachmentSha256:[...attachmentSha256].sort()})]);
  return {policyVersionId:row.rows[0].id,sha256:digest,scope};
 });
}
async function endorsementState(db:import("pg").PoolClient,versionId:string){
 const q=await db.query<{candidacy_id:string;action:string}>(
  "SELECT DISTINCT ON (candidacy_id) candidacy_id,action FROM policy_endorsement_events WHERE policy_version_id=$1 ORDER BY candidacy_id,event_order DESC",
  [versionId]);
 return new Set(q.rows.filter(x=>x.action==="accept").map(x=>x.candidacy_id));
}
async function latestEndorsement(db:import("pg").PoolClient,versionId:string,candidateId:string){
 const q=await db.query<{action:string}>(
  "SELECT action FROM policy_endorsement_events WHERE policy_version_id=$1 AND candidacy_id=$2 ORDER BY event_order DESC LIMIT 1",
  [versionId,candidateId]);
 return q.rows[0]?.action||null;
}
export async function acceptPolicy(input:{branchId:string;candidateId:string;authSubject:string;versionId:string;sha256:string}){
 return transaction(async db=>{
  const member=await participant(db,input.branchId,input.candidateId,input.authSubject);
  const version=await db.query<{content_sha256:string;scope:PolicyScope}>("SELECT content_sha256,scope FROM policy_versions WHERE id=$1 AND branch_id=$2",[input.versionId,input.branchId]);
  if(!version.rowCount)throw new HttpError(404,"Policy version not found in this branch.");
  if(version.rows[0].content_sha256!==input.sha256)
   throw new HttpError(409,"Read and approve the exact immutable policy version.");
  const scope=version.rows[0].scope;
  const previous=await latestEndorsement(db,input.versionId,input.candidateId);
  if(previous==="accept")throw new HttpError(409,"This candidate already actively endorses this version.");
  await db.query("INSERT INTO policy_acceptances(policy_version_id,content_sha256,candidacy_id) VALUES($1,$2,$3) ON CONFLICT (policy_version_id,candidacy_id) DO NOTHING",
   [input.versionId,input.sha256,input.candidateId]);
  await db.query("INSERT INTO policy_endorsement_events(policy_version_id,content_sha256,candidacy_id,action) VALUES($1,$2,$3,'accept')",
   [input.versionId,input.sha256,input.candidateId]);
  const active=await endorsementState(db,input.versionId);
  const jointlyAgreed=active.has(member.originator_candidacy_id)&&active.has(member.responder_candidacy_id);
  await db.query("INSERT INTO publication_events(debate_id,branch_id,actor_candidacy_id,kind,object_id,payload) VALUES($1,$2,$3,$4,$5,$6::jsonb)",
   [member.debate_id,input.branchId,input.candidateId,policyAcceptanceEventKind(jointlyAgreed,scope,previous),
    input.versionId,JSON.stringify({sha256:input.sha256,jointlyAgreed,scope,resolvesDebate:jointlyAgreed&&scope==="full",previous:previous||null})]);
  return {policyVersionId:input.versionId,jointlyAgreed,scope,partialAgreement:jointlyAgreed&&scope==="partial",resolvesDebate:jointlyAgreed&&scope==="full",currentlyEndorsed:true};
 });
}
export async function withdrawPolicy(input:{branchId:string;candidateId:string;authSubject:string;versionId:string;sha256:string}){
 return transaction(async db=>{
  const member=await participant(db,input.branchId,input.candidateId,input.authSubject);
  const version=await db.query<{content_sha256:string;scope:PolicyScope}>("SELECT content_sha256,scope FROM policy_versions WHERE id=$1 AND branch_id=$2",[input.versionId,input.branchId]);
  if(!version.rowCount)throw new HttpError(404,"Policy version not found in this branch.");
  if(version.rows[0].content_sha256!==input.sha256)throw new HttpError(409,"Proposal digest does not match the current immutable version.");
  const previous=await latestEndorsement(db,input.versionId,input.candidateId);
  if(previous!=="accept")throw new HttpError(409,"Only an actively endorsing candidate can withdraw support.");
  await db.query("INSERT INTO policy_endorsement_events(policy_version_id,content_sha256,candidacy_id,action) VALUES($1,$2,$3,'withdraw')",
   [input.versionId,input.sha256,input.candidateId]);
  const active=await endorsementState(db,input.versionId);
  const jointlyAgreed=active.has(member.originator_candidacy_id)&&active.has(member.responder_candidacy_id);
  await db.query("INSERT INTO publication_events(debate_id,branch_id,actor_candidacy_id,kind,object_id,payload) VALUES($1,$2,$3,'policy_endorsement_withdrawn',$4,$5::jsonb)",
   [member.debate_id,input.branchId,input.candidateId,input.versionId,JSON.stringify({sha256:input.sha256,jointlyAgreed:false,
    scope:version.rows[0].scope,historicalAcceptanceRetained:true})]);
  return {policyVersionId:input.versionId,jointlyAgreed,currentlyEndorsed:false,historicalAcceptanceRetained:true};
 });
}
