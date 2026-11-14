import {NextRequest,NextResponse} from "next/server";
import {requireIdentity,requireSameOrigin,record,parseJson,uuid,jsonError,HttpError} from "../../../../../../../lib/server/http";
import {revokeMediaPermission} from "../../../../../../../lib/server/media-permission-revocation";
export const runtime="nodejs";export const dynamic="force-dynamic";
/** Same append-only revocation as edit grants (migration 0027); stops future distribution, never recalls sent copies. */
export async function POST(request:NextRequest,{params}:{params:Promise<{id:string;permissionId:string}>}){
 try{
  requireSameOrigin(request);const user=await requireIdentity(true);const p=await params;
  const b=record(await parseJson(request));
  if(b.reason!==undefined&&b.reason!==null&&typeof b.reason!=="string")throw new HttpError(400,"Reason must be text.");
  const reason=typeof b.reason==="string"&&b.reason.trim()?b.reason.trim():null;
  const result=await revokeMediaPermission({mediaId:uuid(p.id,"media ID"),permissionId:uuid(p.permissionId,"permission ID"),authSubject:user.id,reason});
  return NextResponse.json(result,{status:201,headers:{"Cache-Control":"private,no-store"}});
 }catch(e){return jsonError(e);}
}
