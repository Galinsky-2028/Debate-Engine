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

## Scheduled runs on free hosting

The free Render web service has no always-on worker, so `.github/workflows/scheduled-operations.yml` calls
`POST /api/operations/scheduled-run` every 15 minutes from a free GitHub-hosted runner. No secret is stored anywhere:
the workflow requests a short-lived GitHub Actions OIDC token with audience `public-debate-engine-operations`, and the
endpoint verifies its RS256 signature against GitHub's published keys and accepts it only when the issuer, audience,
repository id `1413777544` (`Galinsky-2028/Debate-Engine`), `refs/heads/main`, the exact workflow file and a
`schedule`/`workflow_dispatch` event all match (`packages/domain/github-oidc.ts`). A fork, another branch, a pull
request or another workflow cannot trigger it. Optionally, another scheduler can use a 64+ character
`OPERATIONS_RUN_TOKEN` environment variable instead (constant-time comparison).

Each call runs one bounded batch of deadline jobs and outbox deliveries — every step is idempotent, so overlapping or
replayed calls are harmless — and records a `scheduled_operations_run` audit event. `/workspace/admin/operations`
shows when the runner last ran and how many runs happened in the past hour. A sleeping free service is woken by the
call and retried once. Tests: `tests/scheduled-token.test.ts`, `tests/github-oidc.test.ts`.
