# Account closure and candidacy withdrawal (PDE-26)

Implements DEVELOPMENT_PLAN §4.2 ("a later withdrawal, party change, or account closure does not rewrite historical attribution or erase the contribution") and the §17 row "Candidate closes account or withdraws from election".

## Account closure: `POST /api/account/close`

The request must be same-origin and signed in with a verified email, with body `{"confirmation":"CLOSE MY ACCOUNT"}`. In one transaction (`lib/server/account-closure.ts`) it:

1. Erases each private draft with the existing erasure core `erasePrivateDraftRecord` (`lib/server/private-retention.ts`, now shared with per-draft erasure):
   - An unpublished draft is deleted, together with its private reports.
   - A published draft keeps only its integrity digest and provenance link.
   - A draft that is mid-confirmation returns 409, and closure can be retried.
2. Deletes the account's remaining private assessment reports and feedback.
3. Revokes every campaign membership the account holds, and every delegated (non-`candidate`) role on candidacies it owns.
4. Sets `accounts.status='closed'` and appends an `account_closed` audit event with counts only.

Every published contribution, question, assessment, objection, agreement, correction and candidacy snapshot stays attributed and public.

Refusing a closed account:

- `requireIdentity` (so `requireAdmin` too) and `syncAccount` in `lib/server/http.ts` return 403 for a non-active account on every authenticated route.
- `verifiedCandidateSource` and `privateOwner` require `a.status='active'`.
- Migration `0025` adds `pde_guard_active_actor` BEFORE INSERT triggers that refuse attributed writes for a closed or suspended account on these tables:
  - debates, submissions, branches and questions
  - corrections, documents, assessments and objections
  - policy versions, acceptances and endorsements
  - captions, derivative approvals, media assets, upload sessions and media permissions
  - candidacies, campaign memberships and private drafts
- `pde_guard_account_status` makes closure final (no reopening) and forbids deleting accounts.

## Withdrawal: `POST /api/candidacies/[id]/withdraw`

Only the active owner account can withdraw, with body `{"confirmation":"WITHDRAW","statement"?: ≤1000 chars}`.

- It appends `candidacy_status_events(candidacy_id, event_type='withdrawn', actor_account_id, public_statement, occurred_at)`. The table is append-only, allows one withdrawal per candidacy, and an SQL trigger requires the actor to own the candidacy.
- A withdrawn candidacy cannot start debates or publish contributions, questions or branch responses. This is enforced in `verifiedCandidateSource` and by the `publish` variant of the SQL trigger.
- Other candidates may still respond to its earlier debates.
- The candidate profile and the directory show "Withdrew from this election on <date>", plus the optional statement.
- Open reply obligations are shown unchanged as open or overdue, with a note that they are not treated as concessions or answers.
- The UI is at `/workspace/account`, linked from `/workspace/privacy`.

## Tests

`tests/restrictions.db.integration.mjs`:
- A closed account cannot publish, correct, register, receive memberships, appeal, be reopened or be deleted. Its publications remain in the public submissions query. The production candidate-actor SQL returns no rows for it.
- A withdrawn candidacy cannot start a debate or publish. Its history stays attributed, and another contender can still respond.
- Withdrawal events are immutable and owner-only.

## Honest limits

- `suspended` accounts are refused the same way as closed ones. Platform administrators suspend and reinstate accounts at `/workspace/admin/accounts` ([state machine](../spec/state-machine.md)): grounds are limited to the published restriction categories, every step is an append-only event with a public notice shown on the candidate's public record, nobody acts on their own account, a closed account cannot be suspended or reinstated, and with more than one configured administrator a different one must reinstate. Suspension never removes, hides or rewrites published contributions. These limits mirror the restriction process; the owner may revise the grounds or add an account-holder appeal.
- Closure does not delete media objects that were uploaded but never published. Their storage cleanup is left to the existing upload maintenance worker.
- Neon Auth identities are not deleted by this endpoint. The platform account is closed; deleting the sign-in identity is a separate provider action.
- Withdrawal is final; there is no reinstatement event, and an account cannot register a second candidacy for the same election.
