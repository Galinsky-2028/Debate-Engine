import "server-only";
import {database} from "./db";
import {HttpError} from "./http";
import {JOINT_AGREEMENT_RECORDS_SQL,ENDORSEMENT_HISTORY_SQL,FUTURE_USE_WITHDRAWALS_SQL} from "./policy-agreement-sql";
import {agreementRecordLabel,agreementRecordSentence,futureUseNotice,type AgreementScope} from "../../packages/domain/policy-view";
type AgreementRow={policy_version_id:string;scope:AgreementScope;content_sha256:string;policy_body:string;changes_summary:string;
 remaining_disagreements:string;addressed_question_ids:string[];attachment_document_ids:string[];created_at:string;parent_version_id:string|null;
 author_name:string;first_joint_at:string;last_joint_at:string;currently_joint:boolean;withdrawn_at:string|null;withdrawn_by:string|null};
type PressRestriction={caseId:string;category:string;publicNotice:string;openedAt:string;appealStatus:string};

export async function pressKitForBranch(branchId:string){
 const header=await database().query<{
  debate_id:string;title:string;proposition:string;published_at:string;
  originator_name:string;originator_id:string;contender_name:string;contender_id:string;
  office:string;election_label:string;
 }>("SELECT d.id AS debate_id,d.title,d.proposition,d.published_at,origin.public_name AS originator_name,d.originator_candidacy_id AS originator_id,contender.public_name AS contender_name,b.responder_candidacy_id AS contender_id,office.title AS office,cycle.label AS election_label FROM debate_branches b JOIN debates d ON d.id=b.debate_id JOIN candidacies origin ON origin.id=d.originator_candidacy_id JOIN candidacies contender ON contender.id=b.responder_candidacy_id JOIN election_cycles cycle ON cycle.id=d.election_id JOIN offices office ON office.id=cycle.office_id WHERE b.id=$1 AND d.status='published'",[branchId]);
 if(!header.rowCount)throw new HttpError(404,"Public debate branch not found.");
 const context=header.rows[0];
 const records=await database().query<AgreementRow>(JOINT_AGREEMENT_RECORDS_SQL,[branchId]);
 if(!records.rowCount)throw new HttpError(409,"This branch has no jointly accepted policy yet.");
 // Prefer a current joint agreement; otherwise disclose the most recent withdrawn one honestly.
 const policy=records.rows[0];
 const [questions,attachments,history,withdrawals,releases]=await Promise.all([
  database().query<{id:string;question_text:string;ordinal:number;asked_by:string}>(
   "SELECT q.id,q.question_text,q.ordinal,c.public_name AS asked_by FROM questions q JOIN submissions s ON s.id=q.submission_id JOIN candidacies c ON c.id=q.asked_by_candidacy_id WHERE s.debate_id=$1 AND s.published_at IS NOT NULL AND (s.branch_id=$2 OR s.kind='opening') ORDER BY s.published_at,q.ordinal",[context.debate_id,branchId]),
  database().query<{id:string;label:string;filename:string;sha256:string}>(
   "SELECT x.id,x.label,x.filename,x.sha256 FROM submission_documents x WHERE x.id=ANY($1::uuid[]) ORDER BY x.sha256",[policy.attachment_document_ids]),
  database().query<{candidate_name:string;action:string;occurred_at:string}>(ENDORSEMENT_HISTORY_SQL,[[policy.policy_version_id]]),
  database().query<{artifact_id:string;owner_name:string;revoked_at:string}>(FUTURE_USE_WITHDRAWALS_SQL,[branchId]),
  database().query<{object_id:string;payload:{policyScope?:string;policyVersionId?:string}}>(
   "SELECT object_id,payload FROM publication_events WHERE branch_id=$1 AND kind='summary_released'",[branchId])
 ]);
 const addressed=new Set(policy.addressed_question_ids);
 const status={scope:policy.scope,currentlyJoint:policy.currently_joint,withdrawnAt:policy.withdrawn_at,withdrawnBy:policy.withdrawn_by};
 const [videos,documents,summaries]=await Promise.all([
  database().query<{submission_id:string;kind:string;candidate_name:string;sha256:string;published_at:string;media_asset_id:string;duration_seconds:string;restriction:PressRestriction|null}>(
   "SELECT s.id AS submission_id,s.kind,c.public_name AS candidate_name,m.original_sha256 AS sha256,s.published_at,m.id AS media_asset_id,m.duration_seconds,pde_public_restriction('submission',s.id) AS restriction FROM submissions s JOIN candidacies c ON c.id=s.candidacy_id JOIN media_assets m ON m.id=s.media_asset_id WHERE s.debate_id=$1 AND (s.branch_id=$2 OR s.kind='opening') AND s.published_at IS NOT NULL ORDER BY s.published_at,s.id",[context.debate_id,branchId]),
  database().query<{id:string;submission_id:string;sha256:string;label:string;filename:string;mime_type:string;restriction:PressRestriction|null}>(
   "SELECT docs.id,docs.submission_id,docs.sha256,CASE WHEN pde_active_restriction_case('document',docs.id) IS NULL THEN docs.label ELSE 'Restricted supporting material' END AS label,CASE WHEN pde_active_restriction_case('document',docs.id) IS NULL THEN docs.filename ELSE 'withheld' END AS filename,docs.mime_type,pde_public_restriction('document',docs.id) AS restriction FROM submission_documents docs JOIN submissions s ON s.id=docs.submission_id WHERE s.debate_id=$1 AND (s.branch_id=$2 OR s.kind='opening') AND s.published_at IS NOT NULL ORDER BY docs.published_at,docs.id",[context.debate_id,branchId]),
  database().query<{id:string;output_sha256:string;source_manifest:unknown;duration_seconds:string|null;restriction:PressRestriction|null}>(
   "SELECT id,output_sha256,CASE WHEN pde_active_restriction_case('derivative',id) IS NULL THEN source_manifest ELSE jsonb_build_object('withheld',true) END AS source_manifest,duration_seconds,pde_public_restriction('derivative',id) AS restriction FROM derivative_artifacts WHERE branch_id=$1 AND status='released' AND rendered_storage_key IS NOT NULL ORDER BY rendered_at DESC,id",[branchId])
 ]);
 return {
  schemaVersion:"1.1.0" as const,
  kind:"mutually_agreed_policy_press_kit" as const,
  generatedAt:new Date().toISOString(),
  debate:{id:context.debate_id,title:context.title,proposition:context.proposition,
   office:context.office,election:context.election_label,publishedAt:context.published_at,
   publicPath:"/debates/"+context.debate_id},
  branch:{id:branchId,originator:context.originator_name,contender:context.contender_name},
  agreement:{versionId:policy.policy_version_id,body:policy.policy_body,
   sha256:policy.content_sha256,proposedBy:policy.author_name,createdAt:policy.created_at,
   parentVersionId:policy.parent_version_id,
   scope:policy.scope,resolvesDebate:policy.scope==="full"&&policy.currently_joint,
   currentlyJoint:policy.currently_joint,withdrawnAt:policy.withdrawn_at,withdrawnBy:policy.withdrawn_by,
   firstJointAt:policy.first_joint_at,lastJointAt:policy.last_joint_at,
   label:agreementRecordLabel(status),
   changesSummary:policy.changes_summary,remainingDisagreements:policy.remaining_disagreements,
   addressedQuestions:questions.rows.filter(q=>addressed.has(q.id)),
   unaddressedQuestions:questions.rows.filter(q=>!addressed.has(q.id)),
   attachments:attachments.rows.map(x=>({...x,publicPath:"/api/documents/"+x.id+"/download"})),
   endorsementHistory:history.rows,
   description:agreementRecordSentence({...status,originator:context.originator_name,contender:context.contender_name})
    +" The platform does not certify it as objectively best."},
  originals:videos.rows.map(v=>({...v,publicPath:v.restriction?null:"/api/media/"+v.media_asset_id+"/play"})),
  supportingDocuments:documents.rows.map(x=>({...x,publicPath:x.restriction?null:"/api/documents/"+x.id+"/download"})),
  releasedSummaries:summaries.rows.map(x=>{
   const release=releases.rows.find(r=>r.object_id===x.id)?.payload||{};
   const withdrawn=withdrawals.rows.filter(w=>w.artifact_id===x.id);
   return {...x,publicPath:x.restriction?null:"/api/branches/"+branchId+"/derivatives/"+x.id+"/download",
    agreementScopeAtRelease:release.policyScope||null,
    label:release.policyScope==="partial"?"Summary of a PARTIAL policy agreement — the debate is not resolved":null,
    futureUseNotices:withdrawn.map(w=>futureUseNotice(w.owner_name,w.revoked_at))};
  }),
  notices:[
    ...(policy.scope==="partial"?["This is a PARTIAL agreement only. The remaining disagreements and unaddressed questions listed here stay open; the debate is not resolved."]:[]),
    ...(policy.currently_joint?[]:["Support for this version was withdrawn; it is not a current joint agreement. The original acceptances remain part of the public history."]),
    "Published original videos are preserved unedited and remain accessible independently of qualifying status.",
    "A complete unedited multi-candidate record is accessible through the debate public path.",
    "No condensed video is represented as released unless the exact output was jointly approved.",
    "The words of participating candidates are their own; these sources are not independent fact-checking.",
    "An item under an exceptional platform restriction is listed with its public notice; its bytes are withheld until the restriction is lifted."
  ]
 };
}
export type PressKit=Awaited<ReturnType<typeof pressKitForBranch>>;
export function pressKitText(k:PressKit,baseURL:string){
 const u=(path:string|null,r?:PressRestriction|null)=>path&&!r?new URL(path,baseURL).toString():"RESTRICTED ("+(r?.category||"restricted")+"): "+(r?.publicNotice||"withheld");
 const intro=[
  "PUBLIC DEBATE ENGINE — PUBLIC PRESS PACKAGE",
  "Debate: "+k.debate.title,
  "Office: "+k.debate.office+" | Election: "+k.debate.election,
  "Participants: "+k.branch.originator+" / "+k.branch.contender,
  "Public full record: "+u(k.debate.publicPath),
  "Status: "+k.agreement.label,
  k.agreement.description,
  "Proposed by: "+k.agreement.proposedBy,
  "Policy version SHA-256: "+k.agreement.sha256,
  "Scope: "+(k.agreement.scope==="partial"?"PARTIAL — does not resolve the debate":"full"),
  "",
  "WHAT CHANGED FROM BOTH PRIOR POSITIONS",
  k.agreement.changesSummary||"(not stated)",
  "",
  "ADDRESSED QUESTIONS ("+k.agreement.addressedQuestions.length+")",
  ...k.agreement.addressedQuestions.map(q=>"- "+q.question_text+" (asked by "+q.asked_by+")"),
  "",
  "QUESTIONS NOT ADDRESSED BY THIS VERSION ("+k.agreement.unaddressedQuestions.length+")",
  ...k.agreement.unaddressedQuestions.map(q=>"- "+q.question_text+" (asked by "+q.asked_by+")"),
  "",
  "REMAINING DISAGREEMENTS",
  k.agreement.remainingDisagreements||"(none stated)",
  "",
  "POLICY ATTACHMENTS ("+k.agreement.attachments.length+")",
  ...k.agreement.attachments.map(d=>d.label+" | "+d.filename+" | SHA-256 "+d.sha256+" | "+u(d.publicPath)),
  "",
  "ENDORSEMENT HISTORY",
  ...k.agreement.endorsementHistory.map(e=>new Date(e.occurred_at).toISOString()+" | "+e.candidate_name+" | "+e.action),
  "",
  k.agreement.scope==="partial"?"FULL TEXT OF THE PARTIAL AGREEMENT":"FULL AGREED POLICY TEXT",
  "-----------------------",
  k.agreement.body,
  "",
  "UNEDITED SOURCE VIDEOS ("+k.originals.length+")"
 ];
 for(const v of k.originals)intro.push(v.candidate_name+" | "+v.kind+" | SHA-256 "+v.sha256+" | "+u(v.publicPath,v.restriction));
 intro.push("","SUPPORTING MATERIALS ("+k.supportingDocuments.length+")");
 for(const d of k.supportingDocuments)intro.push(d.label+" | "+d.filename+" | SHA-256 "+d.sha256+" | "+u(d.publicPath,d.restriction));
 intro.push("","APPROVED SHORT VIDEOS ("+k.releasedSummaries.length+")");
 for(const v of k.releasedSummaries){
  intro.push((v.label?v.label+" | ":"")+"SHA-256 "+v.output_sha256+" | "+u(v.publicPath,v.restriction));
  for(const note of v.futureUseNotices)intro.push("  Note: "+note);
 }
 intro.push("","PRESERVATION AND ATTRIBUTION NOTES",...k.notices);
 return intro.join("\n")+"\n";
}
