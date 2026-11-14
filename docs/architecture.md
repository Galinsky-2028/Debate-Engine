# Architecture

Public Debate Engine is a modular monolith: one Next.js 16 / React 19 application on Node.js 22, one PostgreSQL database, private S3-compatible object storage, and separate worker processes for untrusted-media work. The reasons for each choice are in [decisions/](decisions/README.md). Rules are in [`spec/`](../spec/debate-protocol.md).

## Components

```text
Browser ──HTTPS──> Render web service (Dockerfile, free plan)
                     ├─ app/**            pages, embeds, feed.xml, sitemap
                     ├─ app/api/**        route handlers (auth, CSRF origin check, validation)
                     ├─ lib/server/*      transactions, SQL authorization, storage, scanner
                     ├─ packages/domain/* pure rules (no I/O), unit tested
                     └─ lib/auth/*        Neon Auth (managed Better Auth) session
                         │            │                     ▲
                         ▼            ▼                     │ pull, Bearer token
                 Neon Postgres   Neon S3-compatible    Operator-laptop scanner
                 (project        bucket                (Docker + ClamAV,
                 cool-dawn-…)    debate-originals      compose.scanner.yaml)

CLI workers, run by an operator (no scheduler on the free plan):
  scripts/deadline-worker.mjs  obligation deadlines -> publication_events
  scripts/render-summary.mjs   FFmpeg summary rendering (Dockerfile.worker)
  scripts/cleanup-uploads.mjs  abort expired multipart uploads
  scripts/audit-archive.mjs    re-hash published objects
```

Current identifiers are in [INFRASTRUCTURE.md](INFRASTRUCTURE.md).

## Code layout

| Path | Contents |
| --- | --- |
| `app/` | Public pages (`/`, `/debates`, `/debates/[id]`, `/candidates`, `/press`, `/protocol`, `/embed/debates/[id]`), candidate workspace (`/workspace/**`), API routes |
| `app/api/v1/**` | Versioned read-only public API; contract in `contracts/openapi.yaml`, client in `packages/sdk/` ([PUBLIC_API.md](PUBLIC_API.md)) |
| `lib/server/` | Server-only modules: `db.ts` (pool + `transaction`), `http.ts` (errors, identity, origin, admin), publication (`publish-debate.ts`, `continue-debate.ts`, `confirm-private-publication.ts`), `obligations.ts`, `policy-convergence.ts`, `derivative-rights.ts`, `summary-approval.ts`, media (`resumable-uploads.ts`, `malware.ts`, `laptop-scanner.ts`, `storage.ts`, `video.ts`, `audio.ts`), private assistant modules, `public-debates.ts` (public read model) |
| `packages/domain/` | Pure rules: protocol qualification (`debate.ts`, `sequence.ts`), deadlines, modalities and format checks, rights manifests, summary budgets, captions, discovery, pagination, request origin, release gates, archive integrity |
| `packages/database/migrations/` | Numbered, additive SQL migrations applied by `scripts/migrate.mjs` with checksums and an advisory lock |
| `packages/media/` | ClamAV client, laptop worker, FFmpeg render |
| `scripts/` | Migration runner, workers, smoke/browser/pilot tests, rehearsals, registry tools |
| `registry/` | Canonical 44-unit PR registry and production acceptance gates ([ROADMAP_EVIDENCE.md](ROADMAP_EVIDENCE.md)) |
| `security/` | E2EESA status record and inventory |
| `spec/` | Normative protocol, state machine, permissions, archive policy |

## Request path for a write

1. `requireSameOrigin` rejects cross-origin cookie requests (`packages/domain/request-origin.ts`).
2. `requireIdentity(true)` resolves the Neon Auth session and requires a verified email; `requireAdmin` additionally checks `PLATFORM_ADMIN_USER_IDS`.
3. Input is parsed with `record`/`uuid`/`field` and bounded.
4. `transaction()` proves the actor in SQL (candidacy + auth subject + verified), locks the rows it depends on, writes, and appends `publication_events` / `audit_events` in the same transaction.
5. Triggers re-check ownership and immutability; any violation rolls the transaction back.
6. `jsonError` returns a message for `HttpError` and a generic 500 otherwise (no stack traces or SQL to clients).

## Data model in one paragraph

Accounts and candidacies (per election cycle of an office) → debates (opening rules) → one branch per contender → submissions (opening/response/reply; video, audio or writing) with questions and answer anchors → questioner assessments and responder objections → reply/review obligations → policy versions with digest-bound endorsement events → derivative artifacts with clip-scoped edit permissions and exact-output approvals. Evidence tables are append-only. Private drafts and assistant reports live in separate account-scoped tables that no public query joins. Detail: [DATABASE.md](DATABASE.md), [state machine](../spec/state-machine.md).

## Public read surfaces

Debate pages, `/api/debates`, `/api/v1/**`, `/api/search`, `/feed.xml`, `/sitemap.xml`, embeds and branch press kits read only published rows (`published_at IS NOT NULL`, `status='published'`, released derivatives) and expose public names and candidacy ids, never account ids, emails, drafts, assistant output or verification evidence.

## Media pipeline

Browser preparation (free tier) or hosted preparation (paid entitlement, billing inactive) → resumable 8 MiB multipart upload to private storage → server re-reads the object, checks size and SHA-256 → independent ClamAV verdict (operator laptop in `pull` mode, or a local `clamd` in the paid hosted image `Dockerfile.production`) → FFprobe container/duration check → `media_assets` row in `ready` with a scan attestation. Limits and rationale: [MEDIA_PUBLICATION.md](MEDIA_PUBLICATION.md), [LAPTOP_PROCESSING.md](LAPTOP_PROCESSING.md), [MALWARE_SCANNING.md](MALWARE_SCANNING.md).

## Not present by design

No Redis, queue broker, vector database, blockchain, Kubernetes or mandatory LLM. Jobs and the outbox are tables in Postgres; the assistant is an optional HTTPS adapter that reports "unavailable" when unconfigured.
