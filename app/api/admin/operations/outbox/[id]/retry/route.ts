import {NextRequest,NextResponse} from "next/server";
import {requireAdmin,requireSameOrigin,syncAccount,uuid,jsonError,HttpError} from "../../../../../../../lib/server/http";
import {database} from "../../../../../../../lib/server/db";
import {retryDeadLetter,scheduleOutboxRun} from "../../../../../../../lib/server/outbox";
export const runtime="nodejs";export const dynamic="force-dynamic";
/** Dead-letter recovery: grants three more attempts. Accepted/delivered actions can never be resent. */
export async function POST(request:NextRequest,{params}:{params:Promise<{id:string}>}){
 try{requireSameOrigin(request);const user=await requireAdmin();const id=uuid((await params).id,"outbox action id");
  if(!await retryDeadLetter(database(),id))throw new HttpError(409,"Only dead-letter actions can be retried.");
  const accountId=await syncAccount(user);
  await database().query("INSERT INTO audit_events(actor_account_id,action,target_kind,target_id) VALUES($1,'outbox_dead_letter_retried','outgoing_action',$2)",[accountId,id]);
  scheduleOutboxRun(1);
  return NextResponse.json({requeued:true});
 }catch(e){return jsonError(e);}
}
