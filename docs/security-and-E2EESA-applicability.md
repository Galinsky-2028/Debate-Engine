# Security and E2EESA applicability

This document applies the End-To-End-Everywhere Security Architecture Standard (E2EESA) **by component and data flow**, as plan §14.1 requires. It is an engineering applicability analysis written with AI assistance under the owner's 2026-10-13 policy ([ADR 0008](decisions/0008-ai-assisted-security-review.md)). It is **not** a conformance declaration, certification or independent review. The machine-readable record (`security/e2eesa-status.json`, pinned to upstream commit `8441335f…` on its development basis) keeps implementation, testing and independent review pending, and `security/e2eesa-inventory.json` remains `unverified`. See [E2EESA_ADOPTION.md](E2EESA_ADOPTION.md) for how those records change.

## Principle

Published debate material is public **by design**. For it the protections that matter are integrity, provenance, authorization of who may publish, and availability. Calling it end-to-end confidential would be misleading. Material that is private (drafts, assistant reports, account and verification data, credentials) is protected by server-side access control and transport encryption; **none of it is end-to-end encrypted** today.

## Component and data-flow matrix

| Component / flow | Data | Classification | Controls in place | E2EE applicable? | Gaps |
| --- | --- | --- | --- | --- | --- |
| Public pages, `/api/v1/**`, feed, sitemap, embeds, press kits | published contributions, questions, assessments, events, released summaries | public by design | read only published rows; no account ids/emails; append-only storage; integrity digests (`/api/v1/debates/{id}/integrity`); hostile-text escaping (`xml.test.ts`) | no (public) | no signed/witnessed manifests yet |
| Browser → web (all routes) | session cookies, form data | private in transit | HTTPS (Render TLS); same-origin mutation check (`ORIGIN_SECURITY.md`, `request-origin.test.ts`); JSON size limits | not applicable (server is the intended recipient) | no rate limiting beyond host defaults |
| Neon Auth | credentials, email, Google identity | private, third-party processed | managed service; app stores only the subject id; admins by id | no | custom SMTP before broad enrolment |
| Candidacy verification | public reason; private appeal statement | public reason / private statement | admin-only decisions; private statement never selected by public reads; append-only events | no | — |
| Private drafts and Debate Assistant | unpublished speech, transcripts, model reports, feedback | private | account-scoped SQL on every read/write; owner triggers; erasure and consent revocation; no public query joins these tables (`privacy.db.integration.mjs`) | **would apply**; plan §14.1 prefers local drafts or reviewed E2EE sync | drafts are stored server-side in Postgres in plaintext; documented gap, not hidden |
| Assistant provider call | draft text | private, third-party processed | only with per-draft consent; HTTPS origin only; output validated and grounded | no (intended server-side processing, disclosed) | no provider configured in production |
| Upload → private bucket | original media bytes | private until published, then public | resumable sessions owned by a verified candidate; server re-hash and size check; private objects; 5-minute signed reads | no | Object Lock/retention not configured |
| Bucket → operator scanner | original bytes | private | outbound-only worker; scoped token (≥ 64 chars, constant-time compare); digest- and lease-bound verdicts; uploads refused when offline | no | depends on operator machine hygiene |
| Web → Postgres | all relational data | mixed | TLS to Neon; parameterized SQL; append-only and ownership triggers; transactions | no | single database role; no role separation yet |
| Render worker | source clips, rendered output | public sources, unreleased output | lease owner/token; owner edit grants per clip; non-root container (`WORKER_SAFETY_AND_OPERATIONS.md`) | no | not deployed; egress limits unverified |
| CI / GitHub | source, fictional fixtures | public | CodeQL, `npm audit` (runtime), least-privilege tokens (`SECURITY_STATIC_ANALYSIS.md`) | no | — |
| Secrets | DB URL, auth secret, S3 keys, scanner token | secret | Render environment only; never in Git, URLs or client bundles | — | no rotation runbook yet |

## Application controls and evidence

| Threat (plan §14.2) | Control | Evidence |
| --- | --- | --- |
| forged candidate action / cross-campaign access | SQL proof of candidacy + auth subject + verified on every write; triggers | `db.integration.mjs`, `full-debate-pilot.db.integration.mjs`, CI `candidate-pilot` |
| CSRF | origin/host/forwarded checks; canonical `PUBLIC_APP_ORIGIN` | `request-origin.test.ts` |
| replayed or forged consent/approval | digest-bound acceptance and approvals; one approval per candidate; unique draft→submission | `policy-endorsement.db.integration.mjs`, `confirmation.test.ts` |
| upload abuse, spoofed types, foreign finalization | owned sessions, exact part ranges, server hash, scanner, FFprobe | `upload-parts.test.ts`, `uploads.db.integration.mjs`, `clamav*.test.ts`, `scan-attestation.db.integration.mjs` |
| stored script injection | React escaping; XML escaping; WebVTT and document sniffing | `xml.test.ts`, `captions.test.ts` |
| SSRF | no user-supplied fetch URLs; assistant endpoint is operator configuration and must be a clean HTTPS origin | `lib/server/assistant-model.ts` |
| leaking private data publicly | public queries enumerate columns and published rows only | `privacy.db.integration.mjs`, `public-policy-queries.db.integration.mjs` |
| release without evidence | fail-closed release gates | `release-gates.test.mjs` |

## Open items

Complete and review the E2EESA inventory; decide whether private drafts move to local-only or reviewed E2EE storage; database role separation; secret rotation; rate limiting; signed archive manifests; external expert review (pending, owner-arranged). Restriction and account-closure governance: [archive-and-restriction-policy.md](../spec/archive-and-restriction-policy.md).
