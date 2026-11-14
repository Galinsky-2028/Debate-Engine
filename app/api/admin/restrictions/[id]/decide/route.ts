import {NextRequest,NextResponse} from "next/server";
import {requireSameOrigin,requireAdmin,uuid,parseJson,record,jsonError,syncAccount} from "../../../../../../lib/server/http";
import {decideAppeal} from "../../../../../../lib/server/restrictions";
export const runtime="nodejs";export const dynamic="force-dynamic";
export async function POST(request:NextRequest,{params}:{params:Promise<{id:string}>}){
 try{requireSameOrigin(request);const admin=await requireAdmin();
  const id=uuid((await params).id,"restriction case id"),body=record(await parseJson(request));
  const aid=await syncAccount(admin);
  return NextResponse.json(await decideAppeal(id,aid,body),{headers:{"Cache-Control":"private, no-store"}});
 }catch(e){return jsonError(e);}
}
