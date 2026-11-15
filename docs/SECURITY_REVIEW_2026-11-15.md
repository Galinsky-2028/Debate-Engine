# AI-assisted source security review — November 15, 2026

**Nature of review:** owner-authorized AI-assisted source review under the 2026-10-13 policy in `AGENTS.md` and [ADR 0008](decisions/0008-ai-assisted-security-review.md). It is **not** an independent human audit and does not certify E2EESA conformance. External expert review remains pending follow-up work.

**Scope:** everything that changed in `app/api/**`, `lib/server/**`, `packages/delivery/**`, `packages/domain/**` and `packages/database/migrations/**` since the [November 14 review](SECURITY_REVIEW_2026-11-14.md) at `e34762a` (34 commits, about 2,800 changed lines), plus account suspension (migration `0035`). The focus was on the surfaces those commits added:

- delivery destinations and the outbox (email provider, signed webhooks)
- the GitHub-OIDC operations trigger
- invitations and response clocks
- `distribute` grants and revocation
- account closure, withdrawal and suspension
- restrictions and appeals
- administrator operations and budgets

The [component and data-flow inventory](../security/e2eesa-inventory.json) was completed in the same pass.

**Result:** no critical, high or medium-severity defects. One low-severity finding was fixed.

| # | Severity | Finding | Fix |
| --- | --- | --- | --- |
| 1 | Low | `POST /api/operations/scheduled-run` accepts unauthenticated requests by design (callers prove themselves with a GitHub OIDC token). A token naming an unknown key ID forced a fresh download of GitHub's key set on every request, so anyone could make the service fetch from GitHub as fast as they could send requests. | A forced refresh happens at most once a minute (`jwksFetchNeeded` in `packages/domain/github-oidc.ts`); test in `tests/github-oidc.test.ts`. |

## Controls verified

**Webhook delivery** (`packages/delivery/webhook.ts`, `packages/domain/outbox.ts`):

- HTTPS only, and redirects are not followed.
- Every DNS answer is resolved once and vetted before connecting. The filter refuses loopback, private, link-local, unique-local, multicast, documentation, NAT64, 6to4, Teredo and IPv4-mapped forms. The connection goes to the vetted address with SNI set, which leaves no DNS-rebinding window.
- Request and response sizes are capped, and requests time out after 10 seconds.
- Bodies are HMAC-signed with timestamps.
- Loopback is allowed only outside production behind an explicit test flag.

**Destinations** (`lib/server/destinations.ts`):

- Every operation proves ownership in SQL (candidacy, auth subject and verified status).
- Email verification tokens are stored as SHA-256 hashes with a 72-hour expiry.
- Webhook destinations must echo a signed one-time challenge.
- Duplicates are refused and the count of active destinations is bounded.

**Email** (`packages/delivery/email.ts`):

- The provider must be HTTPS. Redirects are refused.
- The recipient is validated, and CR/LF is stripped from header-like fields.
- A 2xx response is recorded as provider *acceptance* only, never as delivery.

**Operations trigger** (`lib/server/scheduled-operations.ts`):

- The OIDC token is bound to the repository ID, workflow path, `refs/heads/main`, the event types and the audience.
- The optional `OPERATIONS_RUN_TOKEN` is compared in constant time.
- Each run is bounded and idempotent.

**Invitations** (`lib/server/invitations.ts`):

- Only the originator of a published debate can invite, proven in SQL.
- Invitees must be verified candidacies in the same election, and self-invitation is refused.
- Invitations are drafted and then queued; the response clock is durable (migration `0034`).

**Administrator actions:**

- Operations runs, outbox retries, outage extensions, restrictions and suspensions require `requireAdmin` (immutable subject IDs) and a same-origin check, and they write audit events.
- When more than one administrator is configured, a restriction decision or a reinstatement by the administrator who opened the case is refused. Whether a decision was independent is recorded truthfully.

**Account suspension** (migration `0035`):

- Events are append-only and must match the account's status.
- Self-action and inactive actors are refused by a trigger.
- Grounds are limited to the published categories, and the private basis is never shown on public surfaces.
- The existing `pde_guard_active_actor` triggers refuse attributed inserts by suspended accounts. Published records are untouched.

**Public read surfaces:** the routes added since `e34762a` read only published rows and public notices: the restrictions history (`/api/v1/debates/{id}/restrictions`), search, the press kit and derivative previews and downloads after release.

## Checks run on the reviewed source

- `npm run typecheck`
- `npm test`
- `npm run db:migrate && npm run test:db` on a throwaway PostgreSQL 16
- `npm run build`
- CI on the pull request: CodeQL, the high-severity `npm audit` gate, Chromium and two-candidate pilots, live ClamAV, S3 recovery and Postgres integration

## Not covered

- Third-party internals: Neon, Render, Neon Auth, and any future email or AI provider.
- Workers that are not deployed (the hosted ClamAV image and the render worker) were reviewed in source only.
- Manual WCAG and mobile Safari testing.
- An independent human review, which remains pending under the owner's policy.
