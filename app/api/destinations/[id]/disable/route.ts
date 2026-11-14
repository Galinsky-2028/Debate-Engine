import {NextRequest,NextResponse} from "next/server";
import {requireIdentity,requireSameOrigin,uuid,jsonError} from "../../../../../lib/server/http";
import {disableDestination} from "../../../../../lib/server/destinations";
export const runtime="nodejs";export const dynamic="force-dynamic";
export async function POST(request:NextRequest,{params}:{params:Promise<{id:string}>}){
 try{requireSameOrigin(request);const user=await requireIdentity(true);
  return NextResponse.json(await disableDestination({authSubject:user.id,destinationId:uuid((await params).id,"destination id")}));
 }catch(e){return jsonError(e);}
}
