# Policy synthesis, exact-version acceptance and subsequent withdrawal (PDE-19)

A candidate can propose multiple immutable policy texts, optionally linking to an earlier proposal. A joint agreement is recorded only when both verified participants in a branch actively endorse **the same version and content hash**. This is a report of candidate agreement, not a claim that any policy is objectively correct.

## Current endorsement and historical record

- \`policy_acceptances\` records the **first irreversible historical acceptance** for each candidate and version, including previously approved versions. It is never deleted or revised.
- \`policy_endorsement_events\` is a separate append-only event stream. It is backfilled from existing acceptance history. Later events may \`accept\` (including reaffirmation after withdrawal) or \`withdraw\` a candidate's **current** endorsement.
- The current state is the latest event **per candidate and policy version**, ordered by event timestamp and immutable ID. Only versions with both branch participants' current \`accept\` events are jointly endorsed.
- The public policy API exposes current endorsers, active endorsement count and historical acceptance count. A withdrawal produces an attributable public publication event; it never erases past approvals or changes prior media/source records.
- Authorized new summary releases also recheck both participants' **current** policy endorsement. Previously released summary records remain preserved; withdrawal alone is not permission to erase another person's media.
- Two recorded endorsements in different branches never combine into agreement. Actions require verified account ownership and same-branch membership.

## Scoped proposals, counterproposals and partial agreements (migration 0026)

Each `policy_versions` row now also carries immutable `scope` (`full` | `partial`), `addressed_question_ids`, `changes_summary`, `remaining_disagreements` and `attachment_document_ids`. All of them enter the content digest (`packages/domain/policy.ts`, `policyManifestDigest`), with each attachment represented by the SHA-256 of the published supporting document. Changing the scope, a question, a note or an attachment therefore creates a different version, and the `(policy_version_id, content_sha256)` foreign keys make it impossible for an earlier acceptance to carry over. A legacy full-scope proposal with no questions or notes serializes exactly as before (`{body,attachments}`), so every previously issued digest is unchanged; `tests/policy-scope.test.ts` proves this against the original formula.

Rules (server and the `pde_policy_scope` insert trigger as defense in depth):

- a partial proposal must state its remaining disagreements;
- addressed questions must be published questions of the same debate, asked in the opening or in this branch (a question from a rival branch is refused);
- attachments must be published `submission_documents` of the same debate (drafts refused); no duplicates; at most 50 questions and 20 attachments;
- a counterproposal's parent must be a version in the same branch.

Reporting semantics (`packages/domain/policy-view.ts`, `branchAgreement`):

- both candidates currently endorsing the same **full** version → "Joint agreement" (the only state that resolves the debate);
- both currently endorsing the same **partial** version → "Partial agreement only"; remaining disagreements and the questions it does not address stay visible;
- each endorsing a different version → "No joint agreement — candidates endorsed different versions";
- formerly joint, now withdrawn → "No current joint agreement — earlier support was withdrawn", with the history kept.

Publication events: `policy_jointly_accepted` (full) vs `policy_partially_accepted_jointly` (partial); payloads include `scope` and `resolvesDebate`. A joint **full** agreement also closes every still-open review/reply obligation on the branch in the same transaction (`obligations_superseded_by_agreement`, "Closed by the candidates' recorded agreement"); a partial agreement does not, and a later withdrawal reopens nothing retroactively ([DEADLINES_AND_NOTIFICATIONS.md](DEADLINES_AND_NOTIFICATIONS.md)). `acceptPolicy` returns `supersededObligations`.

`GET /api/branches/{id}/policies` returns each version with scope, notes, addressed question ids, attachments (label, filename, SHA-256), parent id, current and historical approvers, plus the branch's published questions and documents and the computed `agreement`. `POST` accepts `scope`, `changesSummary`, `remainingDisagreements`, `addressedQuestionIds`, `attachmentDocumentIds` and `parentVersionId`. The debate page workspace offers a scope selector, question checklist, attachment picker, "Counterpropose from this version" and a line-level diff against the parent version (`lineDiff`).

## Withdrawn agreements in press material

The press kit, `/feed.xml` and `/press` previously decided "mutually accepted" by joining the immutable `policy_acceptances` table, so a policy whose support had been withdrawn was still advertised as a current agreement. All three now use `JOINT_AGREEMENT_RECORDS_SQL` (`lib/server/policy-agreement-sql.ts`), which reads the latest `policy_endorsement_events` per candidate: a version is listed only if both participants once endorsed it simultaneously, it is labelled current, partial or withdrawn (with the withdrawing candidate and date), and the feed adds a separate dated withdrawal item. The press kit (schema 1.1.0) adds scope, addressed and unaddressed questions, remaining disagreements, changes summary, attachment digests and the endorsement history. `releaseSummary` is allowed for a joint partial agreement but records the partial label in the `summary_released` event, and the press kit repeats it.

## Tests

`tests/policy-scope.test.ts` (digest compatibility, each field changes the digest, diff, status rules) and `tests/policy-scope.db.integration.mjs` (trigger refusals, different-versions mismatch, joint partial, attachment/scope change, withdrawal through the shared press/feed/kit query and a source check that none of the three reads `policy_acceptances`).

## Pending scope

Request-changes as a distinct action (counterproposal covers it), an explicit "jointly preferred solution" affirmation text stored with the acceptance, independent candidate browser acceptance, and an independent human review of this feature remain open. The protocol does not infer consensus from silence. (The earlier 40,000-character JSON body limit was replaced by a 256 KiB byte cap in the November 14 security review, which fits a 50,000-character proposal in any script.)
