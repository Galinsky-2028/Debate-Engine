# AI-assisted source security review — November 14, 2026

**Nature of review:** owner-authorized AI-assisted source review under the 2026-10-13 policy in `AGENTS.md`. It is **not** an independent human audit and does not certify E2EESA conformance. External expert review remains pending follow-up work.

**Scope:** every `app/api/**/route.ts`, `lib/server/*`, `lib/auth/*`, origin checking, media/scanner code, all SQL migrations and triggers, Dockerfiles and the scanner compose file, at `main` commit `e34762a`.

**Result:** no critical or high-severity defects. No SQL injection, no IDOR, no private-data exposure through public routes, no authentication bypass was found. Six medium/low findings were fixed:

| # | Severity | Finding | Fix |
| --- | --- | --- | --- |
| 1 | Medium | Press kit, `/press` and RSS treated a policy as jointly accepted from the immutable first-acceptance table even after a candidate withdrew support. | Read the latest `policy_endorsement_events` per candidate (see `docs/POLICY_CONVERGENCE.md`). |
| 2 | Medium | Request bodies were fully buffered before size checks; a chunked body without `Content-Length` bypassed upload limits. | `lib/server/request-body.ts` reads every body through a hard byte cap (JSON 256 KiB, enough for a 50,000-character policy in any script) (`packages/domain/bounded-body.ts`) for JSON, private drafts, multipart uploads, documents and upload parts. |
| 3 | Medium | No framing protection or CSP: workspace publication/approval actions could be clickjacked. | `next.config.ts` sends `frame-ancestors 'none'` + `X-Frame-Options: DENY`, a baseline CSP, `nosniff`, `Referrer-Policy` and `Permissions-Policy` on every route; read-only `/embed/*` pages are deliberately frameable. |
| 4 | Medium | Supporting documents became permanent public downloads without a malware scan; any ZIP passed as DOCX. | Documents pass the same ClamAV / paired laptop-scanner gate as originals and record the verdict (migration `0031_document_scan_evidence.sql`); DOCX must contain `[Content_Types].xml` and `word/document.xml`. |
| 5 | Low | RSS and press-kit ZIP links could fall back to the request Host header. | `lib/server/public-origin.ts` uses configured `PUBLIC_BASE_URL`/`PUBLIC_APP_ORIGIN`/`RENDER_EXTERNAL_URL` and fails closed in production otherwise. |
| 6 | Low | A laptop scan job left pending for over 24 hours permanently blocked those bytes from being scanned. | Re-uploading the same bytes re-queues a stale pending job. |

**Controls verified as correctly implemented:** same-origin enforcement on every cookie-authenticated mutation; forged `x-forwarded-*` rejection; admin access bound to immutable auth subject IDs; server-side re-binding of every client-supplied candidacy to the signed-in subject and verified status; owner scoping of all private drafts/reports with no public route reading `private_*` tables; owner-scoped resumable uploads with exact part sizes and server re-hashing; scanner token comparison with `timingSafeEqual`, lease/digest-bound verdicts and SHA-256-bound attestations; uniqueness and immutability triggers preventing duplicate or altered publication; fully parameterized SQL; sanitized `Content-Disposition`, escaped RSS, sanitized WebVTT; generic error responses; non-root containers.

**Tests:** `tests/hardening.test.ts` (body caps, headers, DOCX structure) plus the existing suites. Header behaviour was also checked against a running production build.
