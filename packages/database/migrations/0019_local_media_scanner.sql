-- Trusted operator laptop worker. Uploaders cannot issue scan verdicts.
CREATE TABLE media_scanner_heartbeat (
 id boolean PRIMARY KEY DEFAULT true CHECK(id),
 last_seen_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE media_scan_jobs (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 original_sha256 char(64) NOT NULL UNIQUE CHECK(original_sha256 ~ '^[0-9a-f]{64}$'),
 storage_key text NOT NULL,
 size_bytes bigint NOT NULL CHECK(size_bytes BETWEEN 64 AND 62914560),
 status text NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','clean','detected')),
 lease_token uuid,
 lease_expires_at timestamptz,
 completed_at timestamptz,
 created_at timestamptz NOT NULL DEFAULT now(),
 CHECK((status='pending')=(completed_at IS NULL))
);
CREATE INDEX media_scan_pending_idx ON media_scan_jobs(created_at) WHERE status='pending';
