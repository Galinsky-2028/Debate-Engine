/**
 * Playback encodes. Pure rules and the SQL the server and its database tests share. The unaltered original is the
 * permanent public record; a ready encode is only a lighter rendition for in-page players.
 */
export const ENCODE_PROFILES=["video-720p-h264","audio-aac-128k"] as const;
export type EncodeProfile=typeof ENCODE_PROFILES[number];
export const ENCODE_MAX_ATTEMPTS=3;
export const ENCODE_LEASE_MINUTES=20;
export const ENCODE_MAX_OUTPUT_BYTES=120*1024*1024;
export const ENCODE_OUTPUT_MIME:Record<EncodeProfile,"video/mp4"|"audio/mp4">={"video-720p-h264":"video/mp4","audio-aac-128k":"audio/mp4"};

export function profileFor(mimeType:string):EncodeProfile|null{
 if(/^video\//i.test(mimeType))return "video-720p-h264";
 if(/^audio\//i.test(mimeType))return "audio-aac-128k";
 return null;
}
export function encodeStorageKey(mediaAssetId:string,sourceSha256:string,profile:EncodeProfile){
 if(!/^[0-9a-f-]{36}$/i.test(mediaAssetId)||!/^[0-9a-f]{64}$/.test(sourceSha256))throw Error("Invalid encode source.");
 return "playback/"+mediaAssetId+"/"+sourceSha256.slice(0,16)+"-"+profile+(profile==="audio-aac-128k"?".m4a":".mp4");
}
/** Which rendition a player gets: the ready encode, unless the caller asks for the original or none is ready. */
export function chooseRendition(requested:string|null,encode:{status:string;storage_key:string|null}|null|undefined):"playback"|"original"{
 if(requested==="original")return "original";
 return encode?.status==="ready"&&encode.storage_key?"playback":"original";
}

/** Queue encodes for published, ready originals that have none yet (idempotent). $1 = how many to queue. */
export const ENQUEUE_PLAYBACK_SQL=`INSERT INTO media_playback_encodes(media_asset_id,source_sha256,profile)
 SELECT m.id,m.original_sha256,CASE WHEN m.mime_type ILIKE 'audio/%' THEN 'audio-aac-128k' ELSE 'video-720p-h264' END
 FROM media_assets m
 WHERE m.processing_status='ready' AND (m.mime_type ILIKE 'video/%' OR m.mime_type ILIKE 'audio/%')
  AND EXISTS(SELECT 1 FROM submissions s JOIN debates d ON d.id=s.debate_id WHERE s.media_asset_id=m.id AND s.published_at IS NOT NULL AND d.status='published')
  AND NOT EXISTS(SELECT 1 FROM media_playback_encodes e WHERE e.media_asset_id=m.id)
 ORDER BY m.created_at LIMIT $1
 ON CONFLICT(media_asset_id) DO NOTHING`;
/** Lease the oldest pending encode. $1 = lease token. */
export const CLAIM_PLAYBACK_SQL=`UPDATE media_playback_encodes e SET lease_token=$1,lease_expires_at=now()+interval '${ENCODE_LEASE_MINUTES} minutes',attempts=e.attempts+1
 FROM media_assets m
 WHERE e.id=(SELECT id FROM media_playback_encodes WHERE status='pending' AND attempts<${ENCODE_MAX_ATTEMPTS}
   AND (lease_expires_at IS NULL OR lease_expires_at<now()) ORDER BY created_at FOR UPDATE SKIP LOCKED LIMIT 1)
  AND m.id=e.media_asset_id
 RETURNING e.id,e.media_asset_id,e.source_sha256,e.profile,e.lease_token,m.storage_key,m.size_bytes,m.mime_type`;
/** Record a verified output. $1 id, $2 lease, $3 key, $4 sha256, $5 bytes, $6 mime. */
export const COMPLETE_PLAYBACK_SQL=`UPDATE media_playback_encodes SET status='ready',storage_key=$3,output_sha256=$4,output_bytes=$5,output_mime=$6,
 completed_at=now(),lease_token=NULL,lease_expires_at=NULL,failure=NULL
 WHERE id=$1 AND lease_token=$2 AND lease_expires_at>now() AND status='pending' RETURNING id`;
/** Release a failed attempt; after the last attempt the encode is marked failed and the original keeps playing. */
export const FAIL_PLAYBACK_SQL=`UPDATE media_playback_encodes SET lease_token=NULL,lease_expires_at=NULL,failure=$3,
 status=CASE WHEN attempts>=${ENCODE_MAX_ATTEMPTS} THEN 'failed' ELSE 'pending' END
 WHERE id=$1 AND lease_token=$2 AND lease_expires_at>now() AND status='pending' RETURNING status`;
/** The playable rendition for a publicly released media asset. */
export const PLAYBACK_FOR_MEDIA_SQL=`SELECT status,storage_key FROM media_playback_encodes WHERE media_asset_id=$1`;
