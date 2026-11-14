-- Supporting documents are permanent public downloads: new rows must carry the clean malware verdict
-- that admitted them. Earlier rows (none in production at the time of this change) remain readable.
ALTER TABLE submission_documents ADD COLUMN IF NOT EXISTS scanner text;
ALTER TABLE submission_documents ADD COLUMN IF NOT EXISTS scan_verdict text;
ALTER TABLE submission_documents ADD COLUMN IF NOT EXISTS scanned_at timestamptz;
ALTER TABLE submission_documents ADD CONSTRAINT submission_documents_scanned_clean
 CHECK (scanner='clamav' AND scan_verdict='clean' AND scanned_at IS NOT NULL) NOT VALID;
-- A pending laptop scan job older than its 24-hour claim window may be re-queued for the same bytes.
