import {NextRequest,NextResponse} from "next/server";
import {requireIdentity,requireSameOrigin,uuid,jsonError,HttpError} from "../../../../../lib/server/http";
import {database} from "../../../../../lib/server/db";
import {verifyWebhookDestination,startEmailVerification} from "../../../../../lib/server/destinations";
import {scheduleOutboxRun} from "../../../../../lib/server/outbox";
export const runtime="nodejs";export const dynamic="force-dynamic";
/** Webhook: signed challenge that must be echoed. Email: (re)send a single-use confirmation link. */
export async function POST(request:NextRequest,{params}:{params:Promise<{id:string}>}){
 try{requireSameOrigin(request);const user=await requireIdentity(true);const id=uuid((await params).id,"destination id");
  const kind=(await database().query<{kind:string}>("SELECT d.kind FROM delivery_destinations d JOIN candidacies c ON c.id=d.candidacy_id AND c.verification_status='verified' JOIN accounts a ON a.id=c.account_id WHERE d.id=$1 AND a.identity_provider='neon-auth' AND a.external_subject=$2",[id,user.id])).rows[0]?.kind;
  if(!kind)throw new HttpError(404,"Destination not found for your verified candidacy.");
  if(kind==="email"){const r=await startEmailVerification({authSubject:user.id,destinationId:id});if(r.queued)scheduleOutboxRun(2);return NextResponse.json(r);}
  return NextResponse.json(await verifyWebhookDestination({authSubject:user.id,destinationId:id}));
 }catch(e){return jsonError(e);}
}
