import {NextRequest,NextResponse} from "next/server";
import {requireIdentity,requireSameOrigin,parseJson,record,uuid,jsonError,HttpError} from "../../../../../lib/server/http";
import {requestDistribution,listDistributions} from "../../../../../lib/server/distributions";
import {scheduleOutboxRun} from "../../../../../lib/server/outbox";
export const runtime="nodejs";export const dynamic="force-dynamic";
export async function GET(request:NextRequest,{params}:{params:Promise<{id:string}>}){
 try{const user=await requireIdentity(true);
  return NextResponse.json(await listDistributions({branchId:uuid((await params).id,"branch id"),candidacyId:uuid(request.nextUrl.searchParams.get("candidacyId"),"candidacyId"),authSubject:user.id}),{headers:{"Cache-Control":"private, no-store"}});
 }catch(e){return jsonError(e);}
}
export async function POST(request:NextRequest,{params}:{params:Promise<{id:string}>}){
 try{requireSameOrigin(request);const user=await requireIdentity(true);const b=record(await parseJson(request));
  if(!Array.isArray(b.destinationIds))throw new HttpError(400,"destinationIds must be a list of your destination ids.");
  const result=await requestDistribution({branchId:uuid((await params).id,"branch id"),candidacyId:uuid(b.candidacyId,"candidacyId"),authSubject:user.id,
   artifactId:b.artifactId?uuid(b.artifactId,"artifactId"):null,policyVersionId:b.policyVersionId?uuid(b.policyVersionId,"policyVersionId"):null,
   destinationIds:b.destinationIds.map((x:unknown)=>uuid(x,"destinationId"))});
  if(result.queued)scheduleOutboxRun(Math.min(10,result.queued));
  return NextResponse.json(result,{status:202});
 }catch(e){return jsonError(e);}
}
