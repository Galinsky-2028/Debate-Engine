import {NextRequest,NextResponse} from "next/server";
import {requireIdentity,requireSameOrigin,parseJson,record,uuid,field,jsonError} from "../../../lib/server/http";
import {createDestination,listDestinations} from "../../../lib/server/destinations";
import {scheduleOutboxRun} from "../../../lib/server/outbox";
export const runtime="nodejs";export const dynamic="force-dynamic";
/** The candidate's own destinations and delivery history. Signing secrets are never listed. */
export async function GET(request:NextRequest){
 try{const user=await requireIdentity(true);
  const result=await listDestinations(user.id,uuid(request.nextUrl.searchParams.get("candidacyId"),"candidacyId"));
  return NextResponse.json(result,{headers:{"Cache-Control":"private, no-store"}});
 }catch(e){return jsonError(e);}
}
export async function POST(request:NextRequest){
 try{requireSameOrigin(request);const user=await requireIdentity(true);const b=record(await parseJson(request));
  if(Array.isArray(b.address)||Array.isArray(b.addresses)||Array.isArray(b.recipients))return NextResponse.json({error:"Recipient lists are not accepted. Add one destination at a time."},{status:400});
  const result=await createDestination({authSubject:user.id,candidacyId:uuid(b.candidacyId,"candidacyId"),kind:b.kind,label:field(b.label,"label",120),address:field(b.address,"address",500),purposes:b.purposes});
  if(result.emailVerification?.startsWith("confirmation queued"))scheduleOutboxRun(2);
  return NextResponse.json(result,{status:201,headers:{"Cache-Control":"private, no-store"}});
 }catch(e){return jsonError(e);}
}
