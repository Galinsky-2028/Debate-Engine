import {NextRequest,NextResponse} from "next/server";
import {requireSameOrigin,requireAdmin,uuid,parseJson,record,jsonError,syncAccount} from "../../../../../../lib/server/http";
import {suspendAccount} from "../../../../../../lib/server/account-suspension";
export const runtime="nodejs";export const dynamic="force-dynamic";
/** Platform administrators only. Suspension never removes or hides published contributions. */
export async function POST(request:NextRequest,{params}:{params:Promise<{id:string}>}){
 try{requireSameOrigin(request);const admin=await requireAdmin();
  const id=uuid((await params).id,"account id"),body=record(await parseJson(request));
  const aid=await syncAccount(admin);
  return NextResponse.json(await suspendAccount(aid,id,body),{headers:{"Cache-Control":"private, no-store"}});
 }catch(e){return jsonError(e);}
}
