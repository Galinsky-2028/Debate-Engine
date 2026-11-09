import {NextResponse} from "next/server";
import {loadPublicDebate} from "../../../../../lib/server/public-debates";
import {uuid,jsonError,HttpError} from "../../../../../lib/server/http";
import {branchSequence} from "../../../../../packages/domain/sequence";
export const runtime="nodejs";export const dynamic="force-dynamic";
export async function GET(_request:Request,{params}:{params:Promise<{id:string}>}){
 try{const id=uuid((await params).id,"debate id");const full=await loadPublicDebate(id);
  if(!full)throw new HttpError(404,"Debate not found.");
  const branches=full.branches.map(b=>{
   const current=branchSequence(full.debate.originator_candidacy_id,b.id,b.responder_candidacy_id,
    full.submissions,full.questions,full.answers,full.assessments);
   const manifests=full.sequenceManifests.filter(m=>m.branch_id===b.id);
   const published=manifests[0];
   return {branchId:b.id,contenderName:b.contender_name,...current,
    currentQualifyingSubmissionIds:current.qualifyingSubmissionIds,
    qualifyingSubmissionIds:published?.submission_ids||current.qualifyingSubmissionIds,
    publishedVersion:published?.revision||null,manifests};
  });
  return NextResponse.json({debateId:id,branches},{headers:{"Cache-Control":"public,max-age=15"}});
 }catch(e){return jsonError(e);}
}
