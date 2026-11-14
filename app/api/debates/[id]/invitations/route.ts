import {NextRequest,NextResponse} from "next/server";
import {requireIdentity,requireSameOrigin,parseJson,record,uuid,jsonError} from "../../../../../lib/server/http";
import {inviteCandidate,publicInvitations} from "../../../../../lib/server/invitations";
import {scheduleOutboxRun} from "../../../../../lib/server/outbox";
export const runtime="nodejs";export const dynamic="force-dynamic";
/** Public invitation states: names, dates and neutral labels only. */
export async function GET(_request:NextRequest,{params}:{params:Promise<{id:string}>}){
 try{return NextResponse.json({invitations:await publicInvitations(uuid((await params).id,"debate id"))},{headers:{"Cache-Control":"public, max-age=30"}});}
 catch(e){return jsonError(e);}
}
export async function POST(request:NextRequest,{params}:{params:Promise<{id:string}>}){
 try{requireSameOrigin(request);const user=await requireIdentity(true);const b=record(await parseJson(request));
  const result=await inviteCandidate({debateId:uuid((await params).id,"debate id"),candidacyId:uuid(b.candidacyId,"candidacyId"),invitedCandidacyId:uuid(b.invitedCandidacyId,"invitedCandidacyId"),authSubject:user.id});
  if(result.queuedDeliveries)scheduleOutboxRun(Math.min(10,result.queuedDeliveries));
  return NextResponse.json(result,{status:result.created?201:200});
 }catch(e){return jsonError(e);}
}
