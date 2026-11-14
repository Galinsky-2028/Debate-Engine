import {NextRequest,NextResponse} from "next/server";
import {requireSameOrigin,requireAdmin,uuid,parseJson,record,jsonError,syncAccount} from "../../../../lib/server/http";
import {openRestriction,listRestrictionsAdmin} from "../../../../lib/server/restrictions";
export const runtime="nodejs";export const dynamic="force-dynamic";
export async function GET(){
 try{await requireAdmin();
  return NextResponse.json({cases:await listRestrictionsAdmin()},{headers:{"Cache-Control":"private, no-store"}});
 }catch(e){return jsonError(e);}
}
/** Platform safety administrators only; campaign ownership is never moderation authority. */
export async function POST(request:NextRequest){
 try{requireSameOrigin(request);const admin=await requireAdmin();
  const body=record(await parseJson(request));
  const targetId=uuid(body.targetId,"target id");
  const aid=await syncAccount(admin);
  const result=await openRestriction(aid,{...body,targetId});
  return NextResponse.json(result,{status:201,headers:{"Cache-Control":"private, no-store"}});
 }catch(e){return jsonError(e);}
}
