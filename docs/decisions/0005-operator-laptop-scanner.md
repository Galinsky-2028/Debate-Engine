# ADR 0005: Operator-laptop scanner on free hosting

**Status:** Accepted (owner decision, November 9, 2026).

## Context

Every original needs an independent malware verdict before validation. ClamAV needs more memory than Render's free web instance provides; paid hosting was not authorized.

## Decision

With `PDE_SCANNER_MODE=pull`, the web service queues scan jobs (`media_scan_jobs`) and a trusted platform operator runs `compose.scanner.yaml` (Docker + ClamAV with official signatures) on their own laptop. The worker polls outbound over HTTPS with a scoped `SCANNER_WORKER_TOKEN`, downloads the object by signed URL, verifies its hash and reports a lease-bound verdict. Uploads are refused while its heartbeat is older than 45 seconds; reading the archive is unaffected. The fully hosted path (`Dockerfile.production`, local `clamd`) is kept for later paid hosting.

## Consequences

- Uploads depend on the operator's computer being awake and online; a saved original resumes validation later.
- An uploader's own browser preparation never substitutes for the verdict.
- The token grants only scan-job access, not database or storage credentials ([LAPTOP_PROCESSING.md](../LAPTOP_PROCESSING.md)).
