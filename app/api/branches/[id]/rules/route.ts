import {NextRequest,NextResponse} from "next/server";
import {requireSameOrigin,requireIdentity,parseJson,record,uuid,jsonError} from "../../../../../lib/server/http";
import {listBranchRules,proposeBranchRules} from "../../../../../lib/server/branch-rules";
export const runtime='nodejs';export const dynamic='force-dynamic';
export async function GET(_request:Request,{params}:{params:Promise<{id:string}>}){
 try{return NextResponse.json(await listBranchRules(uuid((await params).id,'branch id')),{headers:{'Cache-Control':'no-store'}})}catch(error){return jsonError(error)}
}
export async function POST(request:NextRequest,{params}:{params:Promise<{id:string}>}){
 try{
  requireSameOrigin(request);const actor=await requireIdentity(true);const b=record(await parseJson(request));
  const result=await proposeBranchRules({branchId:uuid((await params).id,'branch id'),candidateId:uuid(b.candidacyId,'candidacyId'),authSubject:actor.id,
   baseRevision:Number(b.baseRevision),maxResponseSeconds:Number(b.maxResponseSeconds),replyWindowHours:b.replyWindowHours==null?null:Number(b.replyWindowHours),allowedModalities:b.allowedModalities});
  return NextResponse.json(result,{status:201});
 }catch(error){return jsonError(error)}
}
