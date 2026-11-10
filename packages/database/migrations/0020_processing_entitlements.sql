-- Billing is intentionally inactive. Only trusted server administration may
-- activate an entitlement; a client request never grants paid processing.
ALTER TABLE accounts ADD COLUMN processing_tier text NOT NULL DEFAULT 'free'
 CHECK(processing_tier IN ('free','paid'));
ALTER TABLE media_upload_sessions ADD COLUMN preparation_mode text NOT NULL DEFAULT 'local'
 CHECK(preparation_mode IN ('local','hosted'));
