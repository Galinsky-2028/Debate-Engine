import {NextRequest,NextResponse} from "next/server";
import {requireSameOrigin,requireIdentity,parseJson,record,jsonError} from "../../../../lib/server/http";
import {closeAccount} from "../../../../lib/server/account-closure";
export const runtime="nodejs";export const dynamic="force-dynamic";
export async function POST(request:NextRequest){
 try{requireSameOrigin(request);const user=await requireIdentity(true);
  const body=record(await parseJson(request));
  return NextResponse.json(await closeAccount(user.id,body.confirmation),{headers:{"Cache-Control":"private, no-store"}});
 }catch(e){return jsonError(e);}
}
