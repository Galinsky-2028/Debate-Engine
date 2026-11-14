# Dissemination and notifications (PDE-14 notifications, PDE-23 distribution)

Plan references: `docs/DEVELOPMENT_PLAN.md` §12, §13.1, §13.4 (signed webhooks), §17 rows "Email provider or worker is down" and "Deadline job executes twice".

## What exists

- **Destinations** (`delivery_destinations`, migration `0028`). A verified candidacy owns at most 10 active destinations. Each is exactly one HTTPS webhook URL or one email address — recipient lists, display names, commas/semicolons and control characters are refused (domain rule, route check and SQL `CHECK`). Purposes are a subset of `notifications` and `distribution`. Destinations are disabled, never deleted; address, kind and secret are immutable (trigger).
- **Verification before use.** An unverified destination cannot be the target of any action except its own confirmation (SQL trigger).
  - Webhook: the server generates a 256-bit signing secret with `crypto.randomBytes`, returns it once at creation and never lists it again. `POST /api/destinations/{id}/verify` sends a signed `pde.destination.verification` event; the endpoint must answer 2xx echoing `data.challenge` (JSON `{"challenge":…}` or plain text).
  - Email: a single-use, 72-hour token link (`/workspace/destinations/confirm?d=…&t=…`) is mailed through the email adapter; only its SHA-256 is stored. Confirmation is a POST behind a button so link scanners cannot confirm. With no provider configured the destination honestly stays **"unverified — no email provider configured"** and no token is created.
- **Outbox** (`outgoing_actions`, extended additively). New columns: `destination_id`, `owner_candidacy_id`, `debate_id`, `branch_id`, `subject_kind`, `subject_id`, `next_attempt_at`, `max_attempts`, `lease_token`, `lease_expires_at`, `last_error`, `accepted_at`, `delivered_at`, `dead_at`; states add `delivered` and `dead`. Existing rows stay valid. One row per destination; enqueue is idempotent on `UNIQUE(action_type,destination,dedupe_key)` where `destination='destination:<uuid>'`.
- **Pure rules** in `packages/domain/outbox.ts`: backoff (30 s → 12 h), 8 attempts then dead letter, allowed transitions, honest labels, HMAC signing/verification, SSRF address rules, email/header sanitizing, neutral notification wording, due-soon timing.
- **Shared processor** `packages/delivery/outbox-store.ts` (used by the web server, `scripts/outbox-worker.mjs` and `scripts/deadline-worker.mjs`): claim one row with `FOR UPDATE SKIP LOCKED` + 60 s lease, send, record the result only if the lease token still matches.

## Honest states

| Stored state | Shown as | Meaning |
| --- | --- | --- |
| `pending`, 0 attempts | Queued — not sent | Nothing attempted yet |
| `pending`, `last_error=provider_unconfigured` | Queued — not sent (no email provider configured) | Never counted as an attempt, never marked sent |
| `sending` | Sending | Leased by a processor |
| `accepted` | Accepted by provider (delivery not confirmed) | Email provider 2xx. Not proof of delivery |
| `delivered` | Delivered | Webhook destination answered 2xx (that *is* delivery) |
| `failed` | Attempt failed — retry scheduled | Real error kept in `last_error` |
| `dead`, attempts < max | Failed — not retried | Non-retryable: refused address, redirect, 410, invalid recipient, disabled destination |
| `dead`, attempts = max | Failed after all retries (dead letter) | Admin can requeue with three more attempts |

A trigger makes success terminal: `accepted`/`delivered` can never return to a sendable state, and `accepted_at`/`delivered_at` are permanent. Because each destination has its own row, a failure at one destination never re-sends to another that already succeeded.

## Adapters

- **Webhook** (`packages/delivery/webhook.ts`): HTTPS only (port 443/8443), no credentials or fragments in the URL; DNS is resolved once and every answer must be public (loopback, RFC 1918, CGNAT, link-local incl. `169.254.169.254`, ULA `fc00::/7` incl. `fd00:ec2::254`, IPv4-mapped/NAT64/6to4 embeddings, multicast, documentation ranges are refused); the request connects to the vetted IP (no rebinding window) with SNI/Host of the original name; redirects are never followed; 10 s timeout; 64 KiB request / 16 KiB response caps. Headers: `X-PDE-Event-Id` (outbox action id, stable across retries), `X-PDE-Timestamp` (Unix seconds), `X-PDE-Signature: v1=HMAC_SHA256(secret, "timestamp.eventId.body")`. Receivers should reject timestamps older than 5 minutes and remember processed event ids (delivery is at-least-once if a lease expires mid-send).
- **Email** (`packages/delivery/email.ts`): generic HTTPS JSON provider via `EMAIL_API_URL`, `EMAIL_API_KEY` (Bearer), `EMAIL_FROM`; body `{from,to,subject,text}`. Unset/invalid config → `unconfigured`. CR/LF and control characters are stripped from every header-like field.
- Loopback destinations are allowed only when `NODE_ENV!=='production'` **and** `PDE_ALLOW_LOOPBACK_WEBHOOKS==='true'` (local tests).

## Notifications (PDE-14)

Queued (never sent inline in the transaction) to each verified `notifications` destination of the obligated candidacy:

- when a published contribution opens review/reply obligations (`lib/server/obligations.ts`, key `obligation:<id>:opened:<due>`);
- 24 h before the effective (outage-adjusted) due time, only for windows longer than 48 h (`due_soon`);
- when the deadline worker records `obligation_overdue` (`overdue`).

No `due_soon` or `overdue` notice is queued for an obligation closed by the candidates' recorded agreement. Direct-invitation response clocks ([INVITATIONS.md](INVITATIONS.md)) get `due_soon` and `overdue` notices like other obligations; the invitation itself serves as the opening notice.

Keys use `notificationDedupeKey`, so double execution, concurrent workers or restarts never duplicate a notice. Wording is neutral: "Response due …", "No response received by …"; never "conceded". The deadline job's first check is now scheduled at the due-soon instant when applicable, then rescheduled to the deadline.

## Distribution (PDE-23)

`POST /api/branches/{id}/distributions` `{candidacyId, artifactId | policyVersionId, destinationIds[]}` — the caller must be a verified participant of that branch; an artifact must be `released` (both approvals of the exact file), its edit grants unrevoked, no restriction active, and every source owner must currently grant `distribute` for it (409 names the owner whose permission is missing or withdrawn; [DERIVATIVE_RIGHTS.md](DERIVATIVE_RIGHTS.md)); a policy needs no media grant; a policy must be currently jointly endorsed (latest `policy_endorsement_events` per participant is `accept`). Destinations must be the caller's own verified, active `distribution` destinations (max 10). One outbox action per destination; repeating the request is a no-op per destination. Payload: public URLs and SHA-256 digests only. `GET /api/branches/{id}/distributions?candidacyId=` lists per-destination states truthfully and, per released summary, which owner's distribute permission is current, missing or withdrawn. A database trigger refuses a summary distribution action without current grants, and the outbox processor does not send a queued summary delivery after a grant was withdrawn. `/press` shows "Distributed … to N destinations (provider-confirmed)" only from `accepted`/`delivered` rows.

## Endpoints

`GET/POST /api/destinations`, `POST /api/destinations/{id}/verify`, `POST /api/destinations/{id}/confirm`, `POST /api/destinations/{id}/disable`, `GET/POST /api/branches/{id}/distributions`. UI: `/workspace/destinations`, `/workspace/destinations/confirm`.

## Tests

- `tests/outbox.test.ts`: backoff, dead letter, honest labels, terminal success, signature + replay window, SSRF address/URL rules, DNS-answer vetting, email header injection, unconfigured provider, neutral wording, due-soon rule, invitation projection.
- `tests/outbox.db.integration.mjs` (local `node:http` destination): challenge verification with signature check; owner/limit/immutability triggers; delivery; one failing + one succeeding destination retried without re-sending the success; redirect refused; dead letter after max attempts and admin requeue; duplicate enqueue no-op; unconfigured email never sent, configured provider = accepted not delivered; double/concurrent deadline execution yields one notice per destination; invitation states.

## Honest limits

- No email provider is configured in the current deployment, so email destinations cannot be verified and email notices stay queued.
- The generic email provider gives acceptance only; `delivered` is never set for email (no provider delivery webhooks are implemented).
- Webhook signing secrets are stored in Postgres in plaintext (needed to sign); protect database access accordingly. They are never returned by any list endpoint.
- No independent human security review of this feature has been performed (AI-assisted review and automated tests only).
