import {NextRequest,NextResponse} from "next/server";
import {requireSameOrigin,parseJson,record,uuid,field,jsonError} from "../../../../../lib/server/http";
import {confirmEmailDestination} from "../../../../../lib/server/destinations";
export const runtime="nodejs";export const dynamic="force-dynamic";
/** Mailbox control proof. POST only, so link scanners that prefetch GET URLs cannot confirm on the owner's behalf. */
export async function POST(request:NextRequest,{params}:{params:Promise<{id:string}>}){
 try{requireSameOrigin(request);const b=record(await parseJson(request));
  return NextResponse.json(await confirmEmailDestination(uuid((await params).id,"destination id"),field(b.token,"token",64)));
 }catch(e){return jsonError(e);}
}
