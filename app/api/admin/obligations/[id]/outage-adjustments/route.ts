import {NextRequest,NextResponse} from "next/server";
import {requireSameOrigin,requireAdmin,parseJson,record,uuid,jsonError,syncAccount} from "../../../../../../lib/server/http";
import {transaction} from "../../../../../../lib/server/db";
import {extendObligationForOutage} from "../../../../../../lib/server/outage-adjustments";
export const runtime="nodejs";export const dynamic="force-dynamic";
export async function POST(request:NextRequest,{params}:{params:Promise<{id:string}>}){
 try{
  requireSameOrigin(request);const admin=await requireAdmin();
  const obligationId=uuid((await params).id,"obligation id"),b=record(await parseJson(request));
  const adminAccountId=await syncAccount(admin);
  const result=await transaction(db=>extendObligationForOutage(db,{obligationId,adminAccountId,seconds:b.seconds,publicReason:b.publicReason}));
  return NextResponse.json(result,{status:201});
 }catch(e){return jsonError(e);}
}
