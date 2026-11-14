import {NextRequest,NextResponse} from "next/server";
import {requireAdmin,requireSameOrigin,syncAccount,jsonError} from "../../../../../lib/server/http";
import {database} from "../../../../../lib/server/db";
import {runPendingOperations} from "../../../../../lib/server/outbox";
export const runtime="nodejs";export const dynamic="force-dynamic";
/** Free hosting has no background worker: an administrator can run one bounded batch of deadline jobs + outbox. */
export async function POST(request:NextRequest){
 try{requireSameOrigin(request);const user=await requireAdmin();const accountId=await syncAccount(user);
  const result=await runPendingOperations(25);
  await database().query("INSERT INTO audit_events(actor_account_id,action,target_kind,target_id,context) VALUES($1,'operations_batch_run','account',$1,$2::jsonb)",[accountId,JSON.stringify(result)]);
  return NextResponse.json(result,{headers:{"Cache-Control":"private, no-store"}});
 }catch(e){return jsonError(e);}
}
