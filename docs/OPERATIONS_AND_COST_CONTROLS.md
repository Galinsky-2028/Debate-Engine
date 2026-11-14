# Operations and cost controls (PDE-28 budgets, PDE-29 monitors)

Plan references: §15 (last paragraph), §18, §17 row "Storage/processing budget is exhausted".

## Running without a background worker

The current deployment is a free Render web service with no worker. Therefore:

- after a request queues delivery work (publication, invitation, distribution, email confirmation, dead-letter retry) the server processes a small bounded outbox batch with Next's `after()` once the response is sent; failures stay recorded in the outbox and never fail the request;
- `POST /api/admin/operations/run` (platform admin) runs one bounded batch (25) of `obligation_deadline` jobs and then of the outbox, and records an `audit_events` row;
- on any machine with `DATABASE_URL`: `npm run worker:deadlines` and `npm run worker:outbox` (`node scripts/outbox-worker.mjs --loop` polls every 30 s). All paths share `packages/delivery/outbox-store.ts` and `scripts/deadline-worker.mjs`, so leases and idempotency keys behave the same.

Deadline checks only run when one of these runs. A late check never changes timeliness (receipt time decides), and notices are idempotent, but a due-soon notice can arrive late if nothing ran in time.

## Budgets

| Env var | Counts | Effect when exhausted |
| --- | --- | --- |
| `MEDIA_STORAGE_BUDGET_BYTES` | sum of `media_assets.size_bytes` + declared size of active (`uploading`/`finalizing`, unexpired) upload sessions | new resumable sessions and direct uploads are refused (HTTP 507) with an honest message; `/api/capabilities` reports `mediaStorageBudget: "exhausted"` and blocks the upload preflight |
| `RENDER_BUDGET_SECONDS_PER_DAY` | output seconds rendered since 00:00 UTC + manifest seconds of queued/running render jobs | `enqueueRender` refuses new optional renders (HTTP 429) until the UTC day resets; `/api/capabilities` reports `optionalRendering: "paused_budget_exhausted"` |

Unset means "no cap configured" (reported as such); an invalid value fails closed as 0. Nothing published or stored is ever deleted by a budget check (`packages/domain/budget.ts`, `lib/server/budget.ts`).

## Monitors

`GET /api/admin/operations` (admin; page `/workspace/admin/operations`) returns: durable-job backlog by type/state with oldest due age and recent failures; outbox backlog by action/state, retrying and dead-letter counts with last errors, oldest pending age, actions waiting for an email provider; scanner heartbeat age; storage bytes used vs budget; render seconds today vs budget; verified/unverified/disabled destination counts; whether an email provider is configured. Dead letters can be requeued (`POST /api/admin/operations/outbox/{id}/retry`, three more attempts, audited); accepted/delivered actions can never be retried.

## Tests

`tests/budget.test.ts` (decisions, fail-closed parsing, wiring before storage writes and render enqueue), `tests/outbox.db.integration.mjs` (dead-letter retry, deadline double execution).

## Honest limits

- Render seconds are measured as output media seconds, not CPU time.
- Monitors are pull-only; no alerting channel is configured.
- No spend data from Render/Neon/storage providers is read; budgets are operator-set caps.

## Manual processing (owner decision, 2026-11-14)

Nothing runs automatically. There is no scheduled job, no processing after requests, and no workflow that wakes
the live service on its own. Queued deadline jobs (overdue events, due-soon and overdue notices) and outbox
deliveries (notifications, invitations, distributions, email confirmations) wait in the database until an
administrator processes them:

- **Run pending jobs now** on `/workspace/admin/operations` (one bounded batch of deadline jobs and deliveries), or
- the **Run pending operations (manual)** GitHub workflow (Actions tab → Run workflow), or
- `npm run worker:deadlines` / `npm run worker:outbox` from a machine with `DATABASE_URL`.

Everything stays idempotent, so running a batch twice is harmless. Deadlines are judged on server timestamps, not on
when a batch happens to run: a late batch records an overdue event late but never changes whether a reply was on
time. `/workspace/admin/operations` shows the backlog and the oldest pending item so you can see when a run is due.

To turn automatic processing back on later: set `PDE_AUTOMATIC_PROCESSING=on` on the Render service (deliveries
then run right after the request that queued them) and/or add a `schedule:` trigger back to
`.github/workflows/scheduled-operations.yml`. Keep any schedule coarse (every few hours or less): a free Render
service sleeps after 15 idle minutes and all free services in the workspace share 750 instance-hours a month.

The other GitHub workflows follow the same rule: the PR-registry sync and the live smoke test are manual-only, and
the dependency/CodeQL scan no longer has a weekly schedule (it still runs on pushes and pull requests as CI).

### How the manual workflow authenticates

The workflow requests a short-lived GitHub Actions OIDC token with audience `public-debate-engine-operations`, and
`POST /api/operations/scheduled-run` verifies its RS256 signature against GitHub's published keys and accepts it
only when the issuer, audience, repository id `1413777544` (`Galinsky-2028/Debate-Engine`), `refs/heads/main`, the
exact workflow file and a `schedule`/`workflow_dispatch` event all match (`packages/domain/github-oidc.ts`). No
secret is stored. Optionally, another caller can use a 64+ character `OPERATIONS_RUN_TOKEN` (constant-time
comparison). Each call records a `scheduled_operations_run` audit event. Tests: `tests/github-oidc.test.ts`,
`tests/scheduled-token.test.ts`.
