import {NextRequest,NextResponse} from "next/server";
import {requireSameOrigin,requireAdmin,uuid,parseJson,record,jsonError,syncAccount} from "../../../../../../lib/server/http";
import {reinstateAccount} from "../../../../../../lib/server/account-suspension";
export const runtime="nodejs";export const dynamic="force-dynamic";
/** Platform administrators only; a different administrator when more than one is configured. */
export async function POST(request:NextRequest,{params}:{params:Promise<{id:string}>}){
 try{requireSameOrigin(request);const admin=await requireAdmin();
  const id=uuid((await params).id,"account id"),body=record(await parseJson(request));
  const aid=await syncAccount(admin);
  return NextResponse.json(await reinstateAccount(aid,id,body),{headers:{"Cache-Control":"private, no-store"}});
 }catch(e){return jsonError(e);}
}
