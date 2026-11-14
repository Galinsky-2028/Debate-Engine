# Direct invitations (PDE-05, plan section 5)

## Rules enforced

- Only the verified originator of a **published** debate may invite, and only a **verified** candidacy in the **same election** (route check + `pde_debate_invitation_integrity` trigger, migration `0029`). One invitation per debate and candidacy (`UNIQUE`); rows are append-only.
- A `debate_invitations` row is a **draft**. Delivery goes only through the invited candidate's own verified `notifications` destinations (`packages/delivery/outbox-store.ts#enqueueInvitationDelivery`). No arbitrary addresses are accepted. Repeating the request re-queues only to destinations that have not received it.
- "Sent" is derived solely from provider evidence: the earliest `accepted_at` of an `invitation` outbox action in state `accepted`/`delivered`.
- Public projection (`packages/domain/invitations.ts`):
  - no evidence → **"Invitation drafted — not sent"** (no due date, never an accusation);
  - evidence → **"Invited <date>"** and, if the debate has a reply window, **"Response due <date>"**, computed from `invitedReplyOpenedAt` = max(debate publication, provider acceptance);
  - after the due time with no published contribution by the invitee → **"No response received by <date>"**;
  - a published contribution → "Response received <date>".
- An uninvited verified same-office candidate can still respond; invitations do not gate participation.
- Public output contains names, dates and labels only — never destination addresses or account ids. Creating an invitation appends a `publication_events` row (`invitation_drafted`) and an `audit_events` row.

## Endpoints

- `GET /api/debates/{id}/invitations` — public states.
- `POST /api/debates/{id}/invitations` `{candidacyId, invitedCandidacyId}` — originator only.

The debate page renders `app/debates/[id]/invitation-status.tsx`; the originator sees an invite form.

## Tests

`tests/outbox.test.ts` (projection cases) and `tests/outbox.db.integration.mjs` (trigger refusals, drafted → failed attempt still drafted → provider evidence → "Invited … · Response due …", originator destinations never used).

## Honest limits

Without a configured email provider and without the invitee adding a verified webhook, every invitation remains a draft and is shown as not sent.
