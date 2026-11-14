import {NextRequest,NextResponse} from "next/server";
import {requireSameOrigin,requireIdentity,uuid,parseJson,record,jsonError} from "../../../../../lib/server/http";
import {withdrawCandidacy} from "../../../../../lib/server/account-closure";
export const runtime="nodejs";export const dynamic="force-dynamic";
export async function POST(request:NextRequest,{params}:{params:Promise<{id:string}>}){
 try{requireSameOrigin(request);const user=await requireIdentity(true);
  const id=uuid((await params).id,"candidacy id"),body=record(await parseJson(request));
  return NextResponse.json(await withdrawCandidacy(id,user.id,{confirmation:body.confirmation,statement:body.statement}),{status:201,headers:{"Cache-Control":"private, no-store"}});
 }catch(e){return jsonError(e);}
}
