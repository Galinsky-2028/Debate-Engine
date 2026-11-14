# Branch rule versions (PDE-06)

Plan section 5: the accepted rule version is stored with each submission; changes affecting an existing branch require explicit mutual acceptance, apply prospectively, and never rewrite an expired deadline or make an old contribution newly noncompliant.

## What it does

- Every candidate-to-candidate branch starts at **version 1 = the debate's original published rules** (which are themselves immutable).
- Either verified branch participant may propose new **response limit** (1–7200 seconds; written replies use the published 150-words-per-minute equivalent) and **reply window** (1–720 hours, or no fixed deadline) for that branch. Allowed media stay as published for the debate.
- Publishing a proposal records the proposer's own acceptance. **It has no effect until the other participant accepts that exact proposal** (by its database-computed SHA-256 digest). Then it becomes the next version.
- A new contribution records the `rules_version` in force; its format status and any newly opened review/reply clocks use that version. Earlier contributions keep their recorded version and format status; existing obligation deadlines are never rewritten. Another contender's branch is unaffected.
- A draft records the version shown in the response composer (`rulesVersion` in the private draft payload). If the rules changed before publication, confirmation fails with HTTP 409 and the candidate must review the new rules and prepare a new draft; the platform never accepts different terms on a candidate's behalf. Older drafts without a version count as version 1.

## Rules enforced (migration `0023_branch_rule_versions.sql`)

- Proposals, acceptances and versions are append-only (update/delete refused).
- Only the branch's originator or contender may propose or accept; the actor is proven in SQL (verified candidacy, active Neon Auth account matching the signed-in subject).
- Proposals must name the current base version; a proposal based on superseded rules can no longer be accepted or activated.
- The digest is computed by the database over branch, base version and terms; an acceptance must carry it (foreign key on proposal id + digest).
- A version row is accepted only when both participants accepted the exact current-base proposal, and only as the next revision of its own branch.
- `submissions.rules_version` must equal the branch version in force at insert (opening and new branches: 1).
- Transactions lock the debate, then the branch, in the same order as continuation and assessment publication.

Each proposal and acceptance appends a `publication_events` row (`branch_rules_proposed`, `branch_rules_accepted`, `branch_rules_activated`) and an `audit_events` row.

## Endpoints

- `GET /api/branches/{id}/rules` — rules in force and the public proposal/acceptance history.
- `POST /api/branches/{id}/rules` — `{candidacyId, baseRevision, maxResponseSeconds, replyWindowHours|null}`.
- `POST /api/branches/{id}/rules/{proposalId}/accept` — `{candidacyId, sha256}`.

The public debate page shows the rules in force, every proposal with its acceptances and digest, and each contribution's rules version; branch rows in `/api/debates/{id}` include `rules_version`, `max_response_seconds` and `reply_window_hours`.

## Tests

`tests/branch-rules.test.ts` (pure acceptance/activation and validation rules) and `tests/sequence-rules.db.integration.mjs`: a proposal accepted only by its proposer has no effect; third-party acceptance, impersonation and wrong digests are refused; after mutual acceptance the next contribution records version 2 and is judged by the new limit, while an earlier contribution keeps version 1 and its empty format-issue list and an existing deadline is unchanged; stale proposals/drafts are refused; the second branch stays at version 1.

## Limits

No browser end-to-end test exercises the rule UI; live Neon Auth and hosted operation remain separate acceptance checks. The proposal does not change the number of questions or the allowed media.
