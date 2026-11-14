import {NextRequest,NextResponse} from "next/server";
import {requireIdentity,requireSameOrigin,record,parseJson,uuid,jsonError} from "../../../../../lib/server/http";
import {transaction} from "../../../../../lib/server/db";
import {grantDistributePermission} from "../../../../../lib/server/distribute-permissions";
import {ownMediaPermissions} from "../../../../../lib/server/media-permission-revocation";
export const runtime="nodejs";export const dynamic="force-dynamic";
/** Verified owner only: own grants (edit and distribute) with revocation state. */
export async function GET(_request:NextRequest,{params}:{params:Promise<{id:string}>}){
 try{
  const user=await requireIdentity(true);
  const result=await ownMediaPermissions({mediaId:uuid((await params).id,"media ID"),authSubject:user.id});
  return NextResponse.json({...result,permissions:result.permissions.filter(p=>p.permission==="distribute")},{headers:{"Cache-Control":"private,no-store"}});
 }catch(e){return jsonError(e);}
}
/** Plan 11.2/12: the verified original owner allows distribution of one released summary that uses this video. */
export async function POST(request:NextRequest,{params}:{params:Promise<{id:string}>}){
 try{
  requireSameOrigin(request);const user=await requireIdentity(true);
  const mediaId=uuid((await params).id,"media ID");const b=record(await parseJson(request)),scope=record(b.scope);
  const candidateId=uuid(b.candidacyId,"candidate ID"),artifactId=uuid(scope.artifactId,"artifact ID");
  const result=await transaction(db=>grantDistributePermission(db,{mediaId,candidateId,authSubject:user.id,artifactId}));
  return NextResponse.json(result,{status:201,headers:{"Cache-Control":"private,no-store"}});
 }catch(e){return jsonError(e);}
}
