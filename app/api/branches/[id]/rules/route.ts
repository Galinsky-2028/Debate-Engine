import {NextRequest,NextResponse} from "next/server";
import {requireSameOrigin,requireIdentity,parseJson,record,uuid,jsonError} from "../../../../../lib/server/http";
import {database,transaction} from "../../../../../lib/server/db";
import {listBranchRules,proposeBranchRules} from "../../../../../lib/server/branch-rules";
export const runtime="nodejs";export const dynamic="force-dynamic";
export async function GET(_request:Request,{params}:{params:Promise<{id:string}>}){
 try{
  const branchId=uuid((await params).id,"branch id");const db=await database().connect();
  try{return NextResponse.json(await listBranchRules(db,branchId),{headers:{"Cache-Control":"no-store"}});}finally{db.release();}
 }catch(e){return jsonError(e);}
}
export async function POST(request:NextRequest,{params}:{params:Promise<{id:string}>}){
 try{
  requireSameOrigin(request);const actor=await requireIdentity(true);const b=record(await parseJson(request));
  const branchId=uuid((await params).id,"branch id"),candidateId=uuid(b.candidacyId,"candidacyId");
  const result=await transaction(db=>proposeBranchRules(db,{branchId,candidateId,authSubject:actor.id,
   baseRevision:b.baseRevision,maxResponseSeconds:b.maxResponseSeconds,replyWindowHours:b.replyWindowHours}));
  return NextResponse.json(result,{status:201});
 }catch(e){return jsonError(e);}
}
