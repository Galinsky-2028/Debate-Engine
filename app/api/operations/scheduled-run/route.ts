import {NextRequest,NextResponse} from "next/server";
import {jsonError} from "../../../../lib/server/http";
import {database} from "../../../../lib/server/db";
import {runPendingOperations} from "../../../../lib/server/outbox";
import {requireScheduledOperationsToken} from "../../../../lib/server/scheduled-operations";
export const runtime="nodejs";export const dynamic="force-dynamic";
/**
 * Free hosting has no always-on worker. A scheduled caller holding OPERATIONS_RUN_TOKEN runs one bounded batch of
 * deadline jobs and outbox deliveries. Every step is idempotent, so overlapping or repeated calls are harmless.
 */
export async function POST(request:NextRequest){
 try{
  requireScheduledOperationsToken(request);
  const result=await runPendingOperations(25);
  await database().query("INSERT INTO audit_events(actor_account_id,action,target_kind,target_id,context) VALUES(NULL,'scheduled_operations_run','system',gen_random_uuid(),$1::jsonb)",[JSON.stringify(result)]);
  return NextResponse.json(result,{headers:{"Cache-Control":"no-store"}});
 }catch(e){return jsonError(e);}
}
