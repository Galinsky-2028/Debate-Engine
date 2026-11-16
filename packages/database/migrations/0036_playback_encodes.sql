-- Playback encodes: a smaller H.264/AAC (video) or AAC (audio) rendition of each published original, made by the
-- operator-laptop worker. The unaltered original stays the permanent public record and remains downloadable;
-- the rendition only makes playback lighter. A ready rendition is immutable and bound to the original's digest.

CREATE TABLE IF NOT EXISTS media_playback_encodes(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 media_asset_id uuid NOT NULL UNIQUE REFERENCES media_assets(id),
 source_sha256 char(64) NOT NULL CHECK (source_sha256 ~ '^[0-9a-f]{64}$'),
 profile text NOT NULL CHECK (profile IN ('video-720p-h264','audio-aac-128k')),
 status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','ready','failed')),
 attempts integer NOT NULL DEFAULT 0 CHECK (attempts BETWEEN 0 AND 10),
 lease_token uuid,
 lease_expires_at timestamptz,
 storage_key text UNIQUE,
 output_sha256 char(64) CHECK (output_sha256 IS NULL OR output_sha256 ~ '^[0-9a-f]{64}$'),
 output_bytes bigint CHECK (output_bytes IS NULL OR output_bytes > 0),
 output_mime text CHECK (output_mime IS NULL OR output_mime IN ('video/mp4','audio/mp4')),
 failure text CHECK (failure IS NULL OR length(failure) <= 500),
 created_at timestamptz NOT NULL DEFAULT now(),
 completed_at timestamptz,
 CHECK ((status='ready') = (storage_key IS NOT NULL AND output_sha256 IS NOT NULL AND output_bytes IS NOT NULL AND output_mime IS NOT NULL AND completed_at IS NOT NULL))
);
CREATE INDEX IF NOT EXISTS media_playback_encodes_pending ON media_playback_encodes(created_at) WHERE status='pending';

CREATE OR REPLACE FUNCTION public.pde_guard_playback_encode() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_OP='DELETE' THEN RAISE EXCEPTION 'Playback encodes are retained.' USING ERRCODE='55000'; END IF;
 IF OLD.status='ready' THEN RAISE EXCEPTION 'A ready playback encode is immutable.' USING ERRCODE='55000'; END IF;
 IF NEW.media_asset_id<>OLD.media_asset_id OR NEW.source_sha256<>OLD.source_sha256 OR NEW.profile<>OLD.profile THEN
  RAISE EXCEPTION 'A playback encode stays bound to its original.' USING ERRCODE='55000';
 END IF;
 IF NEW.source_sha256<>(SELECT original_sha256 FROM media_assets WHERE id=NEW.media_asset_id) THEN
  RAISE EXCEPTION 'The encode source digest must match the original.' USING ERRCODE='23514';
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER pde_playback_encode_guard BEFORE UPDATE OR DELETE ON media_playback_encodes
 FOR EACH ROW EXECUTE FUNCTION public.pde_guard_playback_encode();

CREATE OR REPLACE FUNCTION public.pde_guard_playback_encode_insert() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF NEW.source_sha256 IS DISTINCT FROM (SELECT original_sha256 FROM media_assets WHERE id=NEW.media_asset_id AND processing_status='ready') THEN
  RAISE EXCEPTION 'Encodes are made only from a ready original with a matching digest.' USING ERRCODE='23514';
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER pde_playback_encode_insert BEFORE INSERT ON media_playback_encodes
 FOR EACH ROW EXECUTE FUNCTION public.pde_guard_playback_encode_insert();
