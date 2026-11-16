import "server-only";
import {randomUUID} from "node:crypto";
import {database,transaction} from "./db";
import {HttpError} from "./http";
import {hashStoredObject,playOriginal,presignUpload} from "./storage";
import {
 CLAIM_PLAYBACK_SQL,COMPLETE_PLAYBACK_SQL,ENCODE_MAX_OUTPUT_BYTES,ENCODE_OUTPUT_MIME,ENQUEUE_PLAYBACK_SQL,FAIL_PLAYBACK_SQL,
 PLAYBACK_FOR_MEDIA_SQL,encodeStorageKey,type EncodeProfile
} from "../../packages/domain/playback";

/** Queue encodes for newly published originals and lease the oldest pending one to the paired laptop worker. */
export async function claimEncode(){
 const row=await transaction(async db=>{
  await db.query(ENQUEUE_PLAYBACK_SQL,[5]);
  return db.query<{id:string;media_asset_id:string;source_sha256:string;profile:EncodeProfile;lease_token:string;storage_key:string;size_bytes:string;mime_type:string}>(CLAIM_PLAYBACK_SQL,[randomUUID()]);
 });
 if(!row.rowCount)return null;
 const j=row.rows[0];
 const outputKey=encodeStorageKey(j.media_asset_id,j.source_sha256,j.profile);
 const outputMime=ENCODE_OUTPUT_MIME[j.profile];
 return {kind:"encode" as const,id:j.id,sha256:j.source_sha256,sizeBytes:Number(j.size_bytes),leaseToken:j.lease_token,profile:j.profile,
  downloadUrl:await playOriginal(j.storage_key),uploadUrl:await presignUpload(outputKey,outputMime),outputMime,maxOutputBytes:ENCODE_MAX_OUTPUT_BYTES};
}

/** The worker reports a result. A ready rendition is accepted only after the server re-hashes the stored object. */
export async function completeEncode(input:{id:string;leaseToken:string;outcome:"ready"|"failed";outputSha256?:string;outputBytes?:number;failure?:string}){
 if(input.outcome==="failed"){
  const r=await database().query<{status:string}>(FAIL_PLAYBACK_SQL,[input.id,input.leaseToken,(input.failure||"Encode failed.").slice(0,500)]);
  if(!r.rowCount)throw new HttpError(409,"Encode lease expired, was already used, or does not match.");
  return {status:r.rows[0].status};
 }
 if(!/^[0-9a-f]{64}$/.test(input.outputSha256||"")||!Number.isInteger(input.outputBytes)||(input.outputBytes as number)<=0||(input.outputBytes as number)>ENCODE_MAX_OUTPUT_BYTES)
  throw new HttpError(400,"Invalid rendition digest or size.");
 const lease=await database().query<{media_asset_id:string;source_sha256:string;profile:EncodeProfile}>(
  "SELECT media_asset_id,source_sha256,profile FROM media_playback_encodes WHERE id=$1 AND lease_token=$2 AND lease_expires_at>now() AND status='pending'",[input.id,input.leaseToken]);
 if(!lease.rowCount)throw new HttpError(409,"Encode lease expired, was already used, or does not match.");
 const {media_asset_id,source_sha256,profile}=lease.rows[0];
 const key=encodeStorageKey(media_asset_id,source_sha256,profile);
 const stored=await hashStoredObject(key,ENCODE_MAX_OUTPUT_BYTES);
 if(stored.sha256!==input.outputSha256||stored.size!==input.outputBytes)throw new HttpError(422,"The stored rendition does not match the reported digest.");
 const r=await database().query(COMPLETE_PLAYBACK_SQL,[input.id,input.leaseToken,key,stored.sha256,stored.size,ENCODE_OUTPUT_MIME[profile]]);
 if(!r.rowCount)throw new HttpError(409,"Encode lease expired, was already used, or does not match.");
 return {status:"ready"};
}

export async function playbackFor(mediaAssetId:string){
 const r=await database().query<{status:string;storage_key:string|null}>(PLAYBACK_FOR_MEDIA_SQL,[mediaAssetId]);
 return r.rows[0]??null;
}
