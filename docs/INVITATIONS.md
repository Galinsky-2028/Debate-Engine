# Direct invitations (PDE-05, plan section 5)

## Rules enforced

- Only the verified originator of a **published** debate may invite, and only a **verified** candidacy in the **same election** (route check + `pde_debate_invitation_integrity` trigger, migration `0029`). One invitation per debate and candidacy (`UNIQUE`); rows are append-only.
- A `debate_invitations` row is a **draft**. Delivery goes only through the invited candidate's own verified `notifications` destinations (`packages/delivery/outbox-store.ts#enqueueInvitationDelivery`). No arbitrary addresses are accepted. Repeating the request re-queues only to destinations that have not received it.
- "Sent" is derived solely from provider evidence: the earliest `accepted_at` of an `invitation` outbox action in state `accepted`/`delivered`.
- Public projection (`packages/domain/invitations.ts`):
  - no evidence → **"Invitation drafted — not sent"** (no due date, never an accusation);
  - evidence → **"Invited <date>"** and, if the debate has a reply window, **"Response due <date>"** from the durable response clock below (opened at `invitedReplyOpenedAt` = max(debate publication, provider acceptance), including any documented outage extension);
  - after the due time with no published contribution by the invitee → **"No response received by <date>"**;
  - a published contribution → "Response received <date>", with "(within the response window)" or "(after the response window)" when a clock exists.
- An uninvited verified same-office candidate can still respond; invitations do not gate participation.
- Public output contains names, dates and labels only — never destination addresses or account ids. Creating an invitation appends a `publication_events` row (`invitation_drafted`) and an `audit_events` row.

## Endpoints

- `GET /api/debates/{id}/invitations` — public states.
- `POST /api/debates/{id}/invitations` `{candidacyId, invitedCandidacyId}` — originator only.

The debate page renders `app/debates/[id]/invitation-status.tsx`; the originator sees an invite form.

## Response clocks (migration 0034)

"Response due" is no longer display-only. When provider evidence for an invitation is first recorded and the debate has a reply window, a durable reply obligation is opened for the invited candidacy.

**Model.** The obligation is a `reply_obligations` row with `branch_id` NULL, `invitation_id` set (unique) and `source_submission_id` = the debate's opening. A `CHECK` requires either a branch (every ordinary obligation) or an invitation with type `reply` (never both, never neither). This was chosen over a separate `invitation_obligations` table because every existing mechanism keys on `reply_obligations`: outage extensions (foreign key), the deadline worker, `due_soon`/`overdue` notices, the single `obligation_overdue` event per effective due time, the public ledger, the candidate inbox and supersession. A second table would have duplicated all of them and their tests. The invited candidate has no branch until they respond, so a NULL branch tied to the invitation is the accurate model; when they respond, their contribution creates the branch as usual and the invitation clock stays attached to the invitation.

**Opening.** The outbox processor records evidence with its lease-checked UPDATE; the `pde_invitation_evidence_clock` trigger on `outgoing_actions` runs `pde_open_invitation_obligation` in that same statement. It computes `opened_at` = max(debate `published_at`, earliest `accepted_at` of the invitation's accepted/delivered actions) and `due_at` = opened + `debates.reply_window_hours`, inserts the obligation with `ON CONFLICT (invitation_id) DO NOTHING`, enqueues the `obligation_deadline` job with the key format of `lib/server/obligations.ts` (`obligation:<id>:deadline:<ISO due>`; first check 24 h before the deadline for windows over 48 h) and appends one `invitation_response_clock_opened` publication event (invited candidacy, opened and due instants). A second destination's evidence, a retry or a repeated call is a no-op. If opening fails it is logged as a database warning and never undoes the truthful delivery record (which would cause a re-send).

**Guards.** `pde_invitation_obligation_guard` refuses an invitation clock without provider evidence, for another debate or candidacy, with a source other than the opening, without a reply window, or with any other `opened_at`/`due_at`. No clock is opened when the debate has no reply window or the invitee had already published in the debate before the evidence. An uninvited responder never gets one.

**Fulfilment.** The invitee's first published contribution in the debate sets `received_at` = its publication time (`pde_invitation_obligation_fulfilled` trigger on `submissions`); on-time vs late is computed against the effective due time as for every obligation. A contribution published before the clock opened (a race with evidence) is recorded as received at the opening instant, i.e. on time.

**Afterwards.** The deadline worker records `obligation_overdue` once per effective due time (payload includes `invitationId`) and queues the neutral `overdue` notice to the invitee's own verified destinations; administrators can extend it for a documented outage. No separate "opened" notice is queued: the invitation itself was that notice. The public debate page shows the clock in the invitation status and in "Review and reply clocks" as "response to the direct invitation"; the invitee's workspace inbox shows "You were invited to respond. Responding is your choice." with "Response due" / "No response received by the due date" / "Completed on time" / "Reply received late".

## Tests

`tests/outbox.test.ts` (projection cases) and `tests/outbox.db.integration.mjs` (trigger refusals, drafted → failed attempt still drafted → provider evidence → "Invited … · Response due …", originator destinations never used). `tests/invitation-clock.db.integration.mjs`: no evidence or a failed attempt opens no clock; a forged clock is refused; two successful destinations and repeated calls open exactly one clock with the expected instants and job key; an uninvited responder gets none; the first response fulfils on time; a missed window records one overdue event and one notice, then a late response is labelled late; no reply window → no clock. `tests/obligation-closure-and-grants.test.ts`: `invitationResponseClock` and projection with a durable clock.

## Honest limits

Without a configured email provider and without the invitee adding a verified webhook, every invitation remains a draft and is shown as not sent, and no response clock starts. The clock uses the debate's original reply window (an invitee has no branch whose rule versions could apply). Email "acceptance" is provider acceptance, not proof of delivery; the clock starts from it as before.
