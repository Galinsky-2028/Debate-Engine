import {NextResponse} from "next/server";
import {database} from "../../../../../lib/server/db";
import {playOriginal} from "../../../../../lib/server/storage";
import {playbackFor} from "../../../../../lib/server/playback-encodes";
import {chooseRendition} from "../../../../../packages/domain/playback";
import {uuid,jsonError,HttpError} from "../../../../../lib/server/http";
import {activeRestriction,restrictedResponse} from "../../../../../lib/server/restrictions";
export const runtime="nodejs";export const dynamic="force-dynamic";
/**
 * Plays the lighter playback encode when one is ready, otherwise the unaltered original.
 * `?rendition=original` always returns the original, which stays the permanent public record.
 */
export async function GET(request:Request,{params}:{params:Promise<{id:string}>}){
 try{
  const id=uuid((await params).id,"media id");
  const row=await database().query<{storage_key:string}>(
   "SELECT m.storage_key FROM media_assets m JOIN submissions s ON s.media_asset_id=m.id JOIN debates d ON d.id=s.debate_id WHERE m.id=$1 AND m.processing_status='ready' AND s.published_at IS NOT NULL AND d.status='published' LIMIT 1",[id]);
  if(!row.rowCount)throw new HttpError(404,"Media not publicly released.");
  const restriction=await activeRestriction("media",id);if(restriction)return restrictedResponse(restriction);
  const requested=new URL(request.url).searchParams.get("rendition");
  const encode=requested==="original"?null:await playbackFor(id).catch(()=>null);
  const rendition=chooseRendition(requested,encode);
  const url=await playOriginal(rendition==="playback"?encode!.storage_key!:row.rows[0].storage_key);
  return NextResponse.redirect(url,{status:307,headers:{"Cache-Control":"private,no-store","X-PDE-Rendition":rendition}});
 }catch(e){return jsonError(e);}
}
