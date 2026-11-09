import {NextRequest,NextResponse} from "next/server";
import {requireSameOrigin,requireIdentity,parseJson,record,uuid,jsonError,HttpError} from "../../../../../../../lib/server/http";
import {approveBranchRules} from "../../../../../../../lib/server/branch-rules";
export const runtime='nodejs';export const dynamic='force-dynamic';
export async function POST(request:NextRequest,{params}:{params:Promise<{id:string;proposalId:string}>}){
 try{
  requireSameOrigin(request);const actor=await requireIdentity(true);const p=await params;const b=record(await parseJson(request));
  if(typeof b.sha256!=='string'||!/^[a-f0-9]{64}$/.test(b.sha256))throw new HttpError(400,'An exact proposal digest is required.');
  return NextResponse.json(await approveBranchRules({branchId:uuid(p.id,'branch id'),proposalId:uuid(p.proposalId,'proposal id'),candidateId:uuid(b.candidacyId,'candidacyId'),authSubject:actor.id,sha256:b.sha256}));
 }catch(error){return jsonError(error)}
}
