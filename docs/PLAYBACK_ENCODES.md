# Playback encodes

Players on the site can use a lighter rendition of each published video or audio original. The **unaltered original stays the permanent public record**: it is never replaced, every player shows an "Unaltered original file" link, and `/api/media/{id}/play?rendition=original` always returns it.

## How it works

1. The operator-laptop scanner (`compose.scanner.yaml`, [LAPTOP_PROCESSING.md](LAPTOP_PROCESSING.md)) includes FFmpeg. At start it checks for `ffmpeg` and, if present, reports the `encode` capability when it polls `POST /api/scanner/jobs`. Safety scans always come first.
2. When no scan is waiting, the server queues an encode for every published, `ready` video or audio original that has none (`ENQUEUE_PLAYBACK_SQL`). It then leases the oldest pending one to the worker for 20 minutes. The worker gets two signed URLs: a download URL for the original and an upload URL for the rendition, both on the Neon storage host.
3. The worker:
   - checks that both URLs point at the storage region;
   - downloads the original and verifies its size and SHA-256 against the job;
   - encodes it locally (`packages/media/encode.ts`): video at H.264/AAC, at most 1280×720, CRF 26, capped at 2.5 Mb/s; audio at AAC 128 kb/s. Output is MP4 with `+faststart`, local files only (`-protocol_whitelist file`), and the original's metadata is not copied;
   - refuses outputs over 120 MiB, then uploads the rendition and reports its digest and size to `POST /api/scanner/encodes/{id}`.
4. The server re-hashes the stored object and accepts the rendition only if the digest and size match (`lib/server/playback-encodes.ts`). A failed attempt is released and retried up to three times; after that the encode is marked `failed` and players keep using the original.
5. `/api/media/{id}/play` redirects to the ready rendition (`X-PDE-Rendition: playback`), otherwise to the original (`X-PDE-Rendition: original`). Restrictions apply to both.

## Guarantees

Migration `0036`'s `media_playback_encodes` table enforces these:

- One encode per original.
- Bound to the original's digest, and created only from a `ready` original.
- A ready row is immutable and cannot be deleted.
- Ready rows must carry their storage key, digest, size and MIME type.

Tests: `tests/playback-encode.test.ts` (job validation, FFmpeg arguments, digest checks, oversized and failed uploads, rendition choice) and `tests/playback-encode.db.integration.mjs` (queueing, lease, single completion, immutability, retry limit).

## Limits

- Encodes happen only while the operator's scanner is running. Until then players use the original.
- Renditions are not part of the archive audit, which re-hashes only originals. A rendition can be regenerated from its original at any time.
- Captions are served unchanged for both renditions. The encode keeps the original timeline.
