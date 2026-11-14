import {NextRequest,NextResponse} from "next/server";
import {requireSameOrigin,requireIdentity,uuid,parseJson,record,jsonError} from "../../../../../lib/server/http";
import {appealRestriction} from "../../../../../lib/server/restrictions";
export const runtime="nodejs";export const dynamic="force-dynamic";
/** Only the account owning the candidacy that published the restricted item may appeal. */
export async function POST(request:NextRequest,{params}:{params:Promise<{id:string}>}){
 try{requireSameOrigin(request);const user=await requireIdentity(true);
  const id=uuid((await params).id,"restriction case id"),body=record(await parseJson(request));
  return NextResponse.json(await appealRestriction(id,user.id,body.statement),{status:201,headers:{"Cache-Control":"private, no-store"}});
 }catch(e){return jsonError(e);}
}
