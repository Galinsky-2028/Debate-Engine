import { NextRequest, NextResponse } from "next/server";
import { requireIdentity, requireSameOrigin, parseJson, record, uuid, field, jsonError, HttpError } from "../../../../../lib/server/http";
import { database } from "../../../../../lib/server/db";
import { proposePolicy } from "../../../../../lib/server/policy-convergence";
import { branchAgreement } from "../../../../../packages/domain/policy-view";
function idList(value:unknown,label:string,max:number){
 if(value===undefined||value===null)return [];
 if(!Array.isArray(value)||value.length>max)throw new HttpError(400,label+" must be a list of at most "+max+" identifiers.");
 return value.map(x=>uuid(x,label));
}
function note(value:unknown,label:string){
 if(value===undefined||value===null)return "";
 if(typeof value!=="string"||value.length>10000)throw new HttpError(400,label+" must be text of at most 10,000 characters.");
 return value;
}
export const runtime="nodejs";export const dynamic="force-dynamic";
export async function GET(_request:Request,{params}:{params:Promise<{id:string}>}){
 try{
  const id=uuid((await params).id,"branch id");
  const q=await database().query(`SELECT p.id,p.content_sha256,p.policy_body,p.created_at,p.parent_version_id,c.public_name AS proposer,
  p.scope,p.addressed_question_ids,p.changes_summary,p.remaining_disagreements,p.attachment_document_ids,
  COALESCE((SELECT json_agg(json_build_object('id',x.id,'label',x.label,'filename',x.filename,'sha256',x.sha256) ORDER BY x.sha256) FROM submission_documents x WHERE x.id=ANY(p.attachment_document_ids)),'[]'::json) AS attachments,
  COALESCE((SELECT array_agg(a.candidacy_id) FROM policy_acceptances a WHERE a.policy_version_id=p.id),ARRAY[]::uuid[]) AS historical_approvers,
  (SELECT count(*)::integer FROM policy_acceptances a WHERE a.policy_version_id=p.id) AS historical_approval_count,
  (SELECT count(*)::integer FROM (
    SELECT DISTINCT ON (candidacy_id) candidacy_id,action FROM policy_endorsement_events e
     WHERE e.policy_version_id=p.id ORDER BY candidacy_id,event_order DESC
   ) decisions WHERE action='accept') AS approval_count,
  COALESCE((SELECT array_agg(candidacy_id) FROM (
    SELECT DISTINCT ON (candidacy_id) candidacy_id,action FROM policy_endorsement_events e
     WHERE e.policy_version_id=p.id ORDER BY candidacy_id,event_order DESC
   ) decisions WHERE action='accept'),ARRAY[]::uuid[]) AS active_approvers FROM policy_versions p JOIN candidacies c ON c.id=p.proposed_by_candidacy_id JOIN debate_branches b ON b.id=p.branch_id JOIN debates d ON d.id=b.debate_id WHERE p.branch_id=$1 AND d.status='published' ORDER BY p.created_at DESC,p.id DESC LIMIT 100`,[id]);
  const branch=await database().query<{debate_id:string;originator_candidacy_id:string;responder_candidacy_id:string}>(
   "SELECT b.debate_id,d.originator_candidacy_id,b.responder_candidacy_id FROM debate_branches b JOIN debates d ON d.id=b.debate_id WHERE b.id=$1 AND d.status='published'",[id]);
  if(!branch.rowCount)return NextResponse.json({policies:[],questions:[],documents:[],agreement:null},{headers:{"Cache-Control":"public,max-age=20"}});
  const {debate_id,originator_candidacy_id,responder_candidacy_id}=branch.rows[0];
  const [questions,documents]=await Promise.all([
   database().query("SELECT q.id,q.question_text,q.ordinal,c.public_name AS asked_by FROM questions q JOIN submissions s ON s.id=q.submission_id JOIN candidacies c ON c.id=q.asked_by_candidacy_id WHERE s.debate_id=$1 AND s.published_at IS NOT NULL AND (s.branch_id=$2 OR s.kind='opening') ORDER BY s.published_at,q.ordinal",[debate_id,id]),
   database().query("SELECT x.id,x.label,x.filename,x.sha256 FROM submission_documents x JOIN submissions s ON s.id=x.submission_id WHERE s.debate_id=$1 AND s.published_at IS NOT NULL ORDER BY x.published_at,x.id",[debate_id])
  ]);
  // Honest branch status: different versions never combine; partial never resolves; withdrawn stays visible.
  const agreement=branchAgreement(q.rows.map(v=>({id:v.id,scope:v.scope,activeApprovers:v.active_approvers,historicalApprovers:v.historical_approvers})),
   originator_candidacy_id,responder_candidacy_id);
  return NextResponse.json({policies:q.rows,questions:questions.rows,documents:documents.rows,agreement,
   participants:{originatorCandidacyId:originator_candidacy_id,responderCandidacyId:responder_candidacy_id}},{headers:{"Cache-Control":"public,max-age=20"}});
 }catch(e){return jsonError(e);}
}
export async function POST(request:NextRequest,{params}:{params:Promise<{id:string}>}){
 try{requireSameOrigin(request);const actor=await requireIdentity(true);const b=record(await parseJson(request));
 const x=await proposePolicy({branchId:uuid((await params).id,"branch id"),candidateId:uuid(b.candidacyId,"candidacyId"),authSubject:actor.id,body:field(b.policyBody,"policyBody",50000),parentVersionId:b.parentVersionId?uuid(b.parentVersionId,"parentVersionId"):null,
  scope:b.scope===undefined?"full":b.scope==="full"||b.scope==="partial"?b.scope:(()=>{throw new HttpError(400,"Scope must be full or partial.")})(),
  addressedQuestionIds:idList(b.addressedQuestionIds,"addressedQuestionIds",50),attachmentDocumentIds:idList(b.attachmentDocumentIds,"attachmentDocumentIds",20),
  changesSummary:note(b.changesSummary,"changesSummary"),remainingDisagreements:note(b.remainingDisagreements,"remainingDisagreements")});
 return NextResponse.json(x,{status:201});
 }catch(e){return jsonError(e);}
}
