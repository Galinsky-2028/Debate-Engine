import {NextRequest,NextResponse} from "next/server";
import {requireSameOrigin,requireIdentity,parseJson,record,uuid,jsonError} from "../../../../../../../lib/server/http";
import {transaction} from "../../../../../../../lib/server/db";
import {acceptBranchRules} from "../../../../../../../lib/server/branch-rules";
export const runtime="nodejs";export const dynamic="force-dynamic";
export async function POST(request:NextRequest,{params}:{params:Promise<{id:string;proposalId:string}>}){
 try{
  requireSameOrigin(request);const actor=await requireIdentity(true);const p=await params;const b=record(await parseJson(request));
  const branchId=uuid(p.id,"branch id"),proposalId=uuid(p.proposalId,"proposal id"),candidateId=uuid(b.candidacyId,"candidacyId");
  return NextResponse.json(await transaction(db=>acceptBranchRules(db,{branchId,proposalId,candidateId,authSubject:actor.id,sha256:b.sha256})));
 }catch(e){return jsonError(e);}
}
