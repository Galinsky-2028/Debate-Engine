# Deadline and notification contract

PDE-14 represents review and reply duties as separate server-authoritative obligations. A direct-invitation clock begins only after the proposal is usable and there is provider evidence that the invitation was accepted for sending. Drafting an invitation is not delivery evidence.

All stored instants are UTC `timestamptz` values. User interfaces may render the viewer's timezone, but browser clocks never decide lateness. The upload receipt time determines whether a contribution is on time even when scanning or media processing completes later. Late responses remain publishable and recover the exchange while retaining the neutral `fulfilled_late` label.

Documented outage extensions are append-only adjustments with public reasons. Deadline scans enqueue work through the existing `durable_jobs` table. Reminders and overdue notices use a dedupe key containing obligation, phase, and effective due instant, so a restarted or duplicated scan cannot create a second outgoing action. Provider acceptance and delivery remain distinct downstream states; this milestone does not configure or authorize an external notification provider.

Contribution publication fulfills the parent reply clock and opens review/reply clocks in the same transaction; attributed assessments fulfill the matching review clock. The public API exposes neutral open, overdue, fulfilled-on-time, and fulfilled-late projections including outage adjustments. The candidate workspace shows only obligations owned by the signed-in candidate and links each unfinished item to the appropriate review or response flow.

Run one bounded worker batch with `npm run worker:deadlines`. The worker claims due jobs with a database lease and `SKIP LOCKED`, requeues clocks extended by outage evidence, and appends at most one neutral `obligation_overdue` publication event per effective due time before completing the job. It never contacts an external provider. A process supervisor may invoke repeated batches, but no hosted worker is claimed until an authorized deployment records health and execution evidence.

The pure projection and source-level regression tests cover timezone/DST display boundaries, delayed processing, unsent invitations, concurrent/double job execution, outage rescheduling, candidate access scoping, and late-reply recovery. Actual external notification provider integration remains separately gated and unauthorized by this implementation.

## Documented platform outage extensions

Plan section 5: "Documented platform outages can extend affected clocks ... Extensions are visible."

- `GET /api/admin/obligations` (platform administrator only) lists open and overdue review/reply obligations with their original and effective due times and the total extension already applied.
- `POST /api/admin/obligations/{id}/outage-adjustments` (platform administrator only, same-origin) with `{seconds, publicReason}`. `seconds` must be a whole number from 60 to 2,592,000 (30 days); `publicReason` must be 20–1000 characters and is published verbatim. Only an obligation that has a fixed deadline and has not been fulfilled can be extended — a fulfilled obligation's recorded on-time/late status is never changed retroactively (HTTP 409).
- In one transaction the route appends an immutable `obligation_outage_adjustments` row (attributed to the administrator's account, which is never shown publicly), an `audit_events` row (`obligation_outage_extension`), a public `obligation_deadline_extended` publication event (seconds, total extension, reason, new effective due time), and a fresh `obligation_deadline` durable job whose dedupe key contains the new effective due instant. An already-completed job for an earlier due time therefore cannot suppress the new deadline.
- The worker records one `obligation_overdue` event per effective due time. Duplicate or retried jobs for the same time never add a second event; if an extended deadline is missed again, that later miss is recorded once for the new time. Extending an overdue obligation to a future time makes it "Response due" again in every projection.
- The public debate page lists every review/reply clock with its state and effective due time (UTC), and shows each extension next to its obligation with its duration and public reason. The public API (`/api/debates/{id}`, `/api/v1/debates/{id}`) exposes `outageAdjustments` (id, obligation, seconds, public reason, time) without account identifiers.
- Admin page: `/workspace/admin/obligations`.

Tested in `tests/sequence-rules.db.integration.mjs` (effective due time moves, duplicate deadline-job execution yields a single overdue event, an extension after an overdue event enqueues and runs a new job, a future extension leaves its job queued, bounds and fulfilled-obligation refusals, immutability) and `tests/deadlines.test.ts` (validation and job keys). Limits: whether an outage actually occurred is an administrator's documented judgement; there is no automatic outage detection, and no external notification is sent.
