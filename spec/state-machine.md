# State machine

Derived from the migrations in `packages/database/migrations/`, the server modules in `lib/server/`, the workers in `scripts/` and the tests in `tests/`, as of 2026-11-14. The plan (section 8) requires independent state dimensions rather than one overloaded status; this file lists each dimension, how it is stored, and every implemented transition with its actor, preconditions, emitted events, errors and covering tests. Rows marked **not implemented** are required by the plan but have no code in this tree. Everything else was checked against the code after the restriction, closure, branch-rule, manifest, policy-scope, revocation, dissemination, invitation and budget work merged on 2026-11-14. Automated tests prove source behaviour on fictional data only; none of this is operationally accepted ([acceptance-evidence.md](../docs/acceptance-evidence.md)).

Conventions:

- **Verified candidate** means the SQL proof in [debate-protocol.md §2](debate-protocol.md#2-participants): candidacy id + `accounts.identity_provider='neon-auth'` + `external_subject` = authenticated user + `verification_status='verified'`.
- **pub event** = a row in `publication_events` (append-only, public via `GET /api/v1/debates/{id}`). **audit** = a row in `audit_events` (append-only, private).
- Every cookie-authenticated mutation first requires a trusted same-origin request (`requireSameOrigin`, 403) and a signed-in user with a verified email (`requireIdentity(true)`, 401/403). Those errors apply to every row below and are not repeated.
- Append-only tables refuse UPDATE/DELETE with SQLSTATE `55000` (`pde_block_any_mutation`). Ownership triggers raise `23514`.

## 1. Publication

Stored in `private_submission_drafts.status` (`draft` → `reviewed` → `confirming` → `published`), `submissions.published_at` and `debates.status` (`draft`/`published`). Draft content is private to its account; a published row is immutable.

| Transition | Actor | Preconditions | Emits | Errors | Tests |
| --- | --- | --- | --- | --- | --- |
| create draft (`POST /api/private/drafts`) | verified candidate (owner account) | media originals: validated, `ready`, owned by the candidacy, matching medium, clean scan attestation for the same SHA-256. Responses: parent published in a published debate of the same election | none (private) | 403 unowned/unverified media or candidacy; 400 bad shape; 413 size | `privacy.db.integration.mjs` |
| edit draft (`PATCH /api/private/drafts/{id}`) | draft owner | status `draft`/`reviewed`; same author and medium; not erased | none; status back to `draft`, fingerprint recomputed | 409 confirming/published or medium change; 410 erased | `privacy.db.integration.mjs` |
| `draft` → `reviewed` (assess) | draft owner | provider consent; provider configured; transcript for audio/video | private assessment row | 403 no consent; 503 provider unavailable; 422 no transcript; 502 invalid model output | `private-assessment.test.ts`, `assistant-quality.test.ts` |
| `draft` → `reviewed` (skip) | draft owner | not erased | none | 410 erased | `privacy.db.integration.mjs` |
| `reviewed` → `confirming` → `published` (`POST …/confirm`) | draft owner | submitted SHA-256 equals current fingerprint; preliminary assessment for that fingerprint *or* explicit skip; `archiveConsent` and `sequenceConsent` true; then all rules of `publishOpening` / `publishContinuation` | opening: pub `debate_opened`, audit `debate_published`. Continuation: pub `contribution_published` (with `formatIssues`), audit `contribution_published`, `submissions.rules_version` = branch version in force, reply/review obligations, deadline jobs and queued notices (§5), and pub `qualifying_sequence_published` when a new exchange unit qualifies (§4) | 409 fingerprint changed; 409 not reviewed; 400 consents missing; 400 medium/rules/anchors invalid; 404 parent not published; 409 predecessor already continued or first response exists; 409 media already used; 409 branch rules changed since the draft's `rulesVersion`; 403 not a branch participant, withdrawn candidacy or closed account | `confirmation.test.ts`, `full-debate-pilot.db.integration.mjs`, `multimodal.db.integration.mjs`, `format.test.ts`, `sequence-rules.db.integration.mjs` (rules version) |
| stuck `confirming` recovery | draft owner | an existing submission with `origin_draft_id` wins; otherwise retry only after the 5-minute window (`mayRecoverConfirmation`) | none new; no second publication (unique `submissions_one_publication_per_draft`) | 409 still in progress | `confirmation.test.ts` |
| published → modified/deleted | nobody | — | — | `55000` from `pde_published_submissions_immutable`, `pde_published_debates_immutable`, question/answer/media guards | `db.integration.mjs`, `schema.test.ts` |
| correction appended (`POST /api/contributions/{id}/corrections`) | verified author of the contribution | contribution and debate published; 20–5,000 characters | pub `source_correction_published`, audit `source_correction_published` | 403 not author; `23514` from `pde_correction_author` | `corrections.db.integration.mjs` |
| supporting document appended (`POST /api/contributions/{id}/documents`) | verified author | published contribution; PDF/DOCX/text by content sniffing (DOCX must contain `[Content_Types].xml` and `word/document.xml`); ≤ 20 MiB; scanner online and verdict `clean` (same ClamAV / paired laptop-scanner gate as originals; `scanner`, `scan_verdict`, `scanned_at` stored, migration `0031`) | pub `supporting_document_published` | 403; 413; 415; 422 detected; 503 scanner offline/pending | `archive-integrity.test.mjs`, `hardening.test.ts` |
| caption published (`POST /api/media/{id}/captions`) | verified owner of the original | valid WebVTT within the media duration | `media_captions` row (append-only) | 400; 403 | `captions.test.ts` |
| published → visibility restricted (`POST /api/admin/restrictions`) | platform safety administrator (`PLATFORM_ADMIN_USER_IDS`, active account) who owns no participating candidacy in that debate and holds no active campaign membership for one | target is a published submission, supporting document or released derivative; category in the fixed list; public notice 20–1,000 chars sharing no six-word run with the material or private basis; no active case on the target | `restriction_cases` (`active`) + `restriction_events` `opened`; pub `restriction_opened` (no account ids, no private basis); audit `restriction_opened`. The row, counts and sequence position stay; bytes are withheld (HTTP 451 on play/captions/download/preview, `written_content: null`, skipped by search) | 403 not admin or a participant/delegate (`23514`); 404 target not published; 400 notice; 409 already restricted | `restrictions.db.integration.mjs`, `restrictions.test.ts` |

The restriction case itself is §8 "Restriction case". Nothing in this table ever updates or deletes a published row.

## 2. Media

Three stored machines feed one public fact: a `media_assets` row in `ready`.

**Upload session** (`media_upload_sessions.status`):

| Transition | Actor | Preconditions | Emits | Errors | Tests |
| --- | --- | --- | --- | --- | --- |
| → `uploading` (`POST /api/media/uploads`) | verified candidate | scanner online (`requireScannerPreflight`); declared size 64 B–60 MiB; 8 MiB parts; SHA-256 declared; hosted preparation only with a stored `paid` tier; `MEDIA_STORAGE_BUDGET_BYTES` not exhausted (stored assets + active sessions) | none | 503 scanner offline (no S3 session created); 507 storage budget exhausted; 400; 403 | `uploads.db.integration.mjs`, `upload-parts.test.ts`, `budget.test.ts` |
| part upload (`PUT …/parts/{n}`) | session owner | `uploading`, not expired, exact byte range | none | 409 not accepting; 400 wrong range | `upload-parts.test.ts` |
| `uploading` → `finalizing` → `completed` (`POST …/complete`) | session owner | stored size and SHA-256 equal the declaration; scanner verdict `clean`; FFprobe container matches medium | inserts `media_assets` (`ready`) + `media_scan_attestations`; audit `media_validated` | 422 size/hash mismatch or detected; 415 wrong medium; 503 scanner pending (session stays `finalizing`, resumable) | `uploads.db.integration.mjs`, `scan-attestation.db.integration.mjs` |
| `finalizing` → `failed` | system | validation error 413/415/422 | none | — | `uploads.db.integration.mjs` |
| `uploading` → `aborted` (`DELETE …/{id}` or expiry cleanup) | owner, or `npm run worker:uploads:cleanup` | only `uploading`; finalizing/completed originals are never deleted this way | none | 409 finalized | `upload-maintenance.test.mjs` |

**Scan job** (`media_scan_jobs.status`, operator-laptop mode `PDE_SCANNER_MODE=pull`): `pending` → leased by the paired worker (`claimScan`, 2-minute lease, heartbeat) → `clean` or `detected`; an `unavailable` report releases the lease. Actor: the paired scanner (Bearer token ≥ 64 chars, constant-time compare). Errors: 401 unpaired; 409 lease expired/reused/digest mismatch. Tests: `laptop-scanner.db.integration.mjs`, `laptop-scanner.http.integration.mjs`, `laptop-worker.test.ts`, `clamav*.test.ts`. In hosted mode the web process scans through the local `clamd` socket instead.

**Media asset** (`media_assets.processing_status`): the application only ever inserts `ready`, after hashing, scanning and probing; a rejected file never becomes an asset. The schema values `quarantined`, `validating` and `rejected` are reserved. Playback serves a short-lived signed URL to the unaltered original; separate playback encodes and a `degraded` state are **not implemented** (they belong to the hosted media worker, [WORKER_SAFETY_AND_OPERATIONS.md](../docs/WORKER_SAFETY_AND_OPERATIONS.md)). While a restriction case is active, playback returns HTTP 451. A `ready` asset used by a published submission cannot be modified (`pde_media_guard`) or reused (`pde_one_submission_per_source`).

## 3. Assessment

Per (question, answering submission). No stored status column: the state is the latest `assessments` row.

| Transition | Actor | Preconditions | Emits | Errors | Tests |
| --- | --- | --- | --- | --- | --- |
| awaiting review → `answered` / `partly_answered` / `not_answered` / `disputed_premise` (`POST /api/assessments`) | verified candidate who asked the question | answer is the immediately following, published opponent contribution in the same debate; reason 1–4,000 chars | pub `question_assessed`; fulfils the matching review obligation; pub `qualifying_sequence_published` when the assessment completes a qualifying unit (§4) | 400 unsupported decision; 403 not your question; `23514` from `pde_guard_assessment` | `protocol.test.ts`, `sequence.test.ts`, `full-debate-pilot.db.integration.mjs`, `obligation-wiring.test.ts` |
| reversal | same questioner | new row with `supersedes_assessment_id` = previous latest for the same question/answer/reviewer | pub `question_assessed` | `23514` mismatched reversal | `sequence.test.ts` |
| objection (`POST /api/assessment-objections`) | verified author of the assessed contribution | assessment exists on their published contribution; optional non-negative timestamp | pub `assessment_objected` | 403; `23514` from `pde_objection_author` | `full-debate-pilot.db.integration.mjs` |

For qualification only `answered` counts as accepted; every other judgment is "not accepted". Assessments and objections are append-only. Migration `0022` adds an insertion-ordered `event_order`, so the "latest" decision cannot be reordered by equal timestamps or UUID order (`sequence.test.ts`).

## 4. Inclusion

The current projection is computed on read by `branchSequence` (`packages/domain/sequence.ts`) over the immutable record. States per exchange unit: `awaiting_originator_assessment`, `footnoted`, `footnoted_format`, `awaiting_originator_answer`, `awaiting_responder_assessment`, `reciprocity_disputed`, `qualified` (meanings in [debate-protocol.md §5](debate-protocol.md#5-reciprocal-exchange-units)). A published contribution that is not in `qualifyingSubmissionIds` is "public only". Read via `GET /api/debates/{id}/sequence` and the debate page. Tests: `protocol.test.ts`, `sequence.test.ts`, `format.test.ts`, `multimodal.db.integration.mjs`, `full-debate-pilot.db.integration.mjs`.

**Published sequence revisions** (`qualifying_sequence_manifests`, migration `0021`; [QUALIFYING_SEQUENCE_UI.md](../docs/QUALIFYING_SEQUENCE_UI.md)). They supersede the unused `sequence_versions`/`sequence_entries` tables from `0001`, which remain in the schema but are read and written by nothing.

| Transition | Actor | Preconditions | Emits | Errors | Tests |
| --- | --- | --- | --- | --- | --- |
| revision N+1 appended | system, inside the continuation-publication or assessment transaction (`preserveQualifyingSequence`, `lib/server/sequence-manifests.ts`); readers never create history | projection (with earlier revisions as preserved prefix) has more complete exchange units than revision N and extends its exact prefix; the `pde_sequence_manifest_validate` trigger independently re-checks parent chain, alternation, no format issues, every question answered and accepted (latest decision), and the owner's `sequence` permission | row with database-computed `manifest_sha256`; pub `qualifying_sequence_published` | trigger refusal (`23514`) is caught by a savepoint: the publication/assessment still succeeds and no revision is written | `sequence.test.ts`, `sequence-rules.db.integration.mjs` |
| revision modified/deleted, truncated, skipped or on the wrong branch | nobody | — | — | `55000` / `23514` | `sequence-rules.db.integration.mjs` |
| later reversal | questioner (new assessment) | — | visible in the complete record; the published revision stays and later exchanges may still extend it | — | `sequence-rules.db.integration.mjs` |

`GET /api/debates/{id}/sequence` returns per branch the latest published revision (else the projection) as `qualifyingSubmissionIds`, plus `currentProjectionSubmissionIds`, `publishedRevision`, `rulesVersion` and all manifests. Legacy branches were not backfilled; they show the projection until their next qualifying event. The digest is an integrity checksum, not a signature.

## 5. Obligation

`reply_obligations` (`obligation_type` `review` or `reply`), with `opened_at`, `due_at`, `received_at`, `processed_at`, plus append-only `obligation_outage_adjustments`. The state is projected (`projectObligation`, and the same CASE expression in `lib/server/public-debates.ts`):

| Transition | Actor | Preconditions | Emits | Errors | Tests |
| --- | --- | --- | --- | --- | --- |
| → `open` | system, inside the publication transaction of a continuation | continuation answers questions → review obligation for the questioner; asks questions → reply obligation for the opponent; `due_at` = publication + reply window (none if unlimited) | `durable_jobs` row `obligation_deadline` keyed by obligation and due time | unique key makes it idempotent | `obligation-wiring.test.ts` |
| `open` → `fulfilled_on_time` / `fulfilled_late` | system | reply: the obligated candidate publishes the continuation; review: the questioner records an assessment. Compared with the effective due time | carried by the triggering pub event | — | `deadlines.test.ts`, `obligation-wiring.test.ts` |
| `open` → `overdue` | time; `npm run worker:deadlines` | effective due (due + Σ adjustments) passed with no receipt | pub `obligation_overdue` once per effective due time; queued `overdue` notices (below) | leased, `SKIP LOCKED`, re-queues if an adjustment moved the due time | `deadline-worker.test.ts`, `sequence-rules.db.integration.mjs`, `outbox.db.integration.mjs` |
| `overdue` → `fulfilled_late` | obligated candidate | late publication/assessment | as above | — | `deadlines.test.ts` |
| outage adjustment added (`POST /api/admin/obligations/{id}/outage-adjustments`) | platform administrator (same-origin) | obligation has a fixed `due_at` and no receipt; `seconds` 60–2,592,000; `publicReason` 20–1,000 chars | append-only `obligation_outage_adjustments` row; audit `obligation_outage_extension`; pub `obligation_deadline_extended` (seconds, total, reason, new effective due; no account id); new `obligation_deadline` job keyed by the new effective due instant. An overdue obligation extended into the future projects as open again | 400 bounds; 404; 409 already fulfilled (timeliness never rewritten); 409 no fixed deadline; 403 not admin | `sequence-rules.db.integration.mjs`, `deadlines.test.ts` |
| notices queued | system | a verified, active `notifications` destination of the obligated candidacy (§8) | outbox actions for phase `opened` (at publication), `due_soon` (24 h before the effective due time, windows > 48 h only) and `overdue` (with the worker's event); dedupe key = obligation + phase + effective due | unique key: no duplicate notice on double execution | `outbox.test.ts`, `outbox.db.integration.mjs` |
| superseded by recorded agreement | — | **not implemented**: a joint policy agreement does not close or relabel open obligations | | | |

The deadline worker is a CLI. On the current free deployment nothing runs it on a schedule: a platform administrator runs a bounded batch from `/workspace/admin/operations` (`POST /api/admin/operations/run`, audit `operations_batch_run`), or an operator runs `npm run worker:deadlines` / `npm run worker:outbox`. Overdue labels shown by public reads are computed from the clock and stay correct without it; a `due_soon` notice can arrive late if nothing ran in time.

**Invitation clock** ([INVITATIONS.md](../docs/INVITATIONS.md)): not a `reply_obligations` row. The public invitation projection (`packages/domain/invitations.ts`) shows "Invitation drafted — not sent" until an `invitation` outbox action has provider evidence (`accepted_at` in state `accepted`/`delivered`); then "Invited", and with a reply window "Response due" from `invitedReplyOpenedAt` = max(debate publication, provider acceptance), "No response received by …" after it, or "Response received". No deadline job or `obligation_overdue` event exists for invitations. Tests: `outbox.test.ts`, `outbox.db.integration.mjs`, `deadlines.test.ts`.

## 6. Branch

`debate_branches` has no status column; branch state is derived.

| State | Derivation |
| --- | --- |
| awaiting response | debate published, no branch row for a contender yet |
| active | branch exists (created atomically by the contender's first published response, one per contender) |
| inactive | an open obligation is `overdue` (neutral label; never a concession) |
| resolution proposed | a `policy_versions` row exists for the branch (pub `policy_version_proposed`) |
| resolved | both participants' latest `policy_endorsement_events` for the same **`full`**-scope version are `accept` (pub `policy_jointly_accepted`, `resolvesDebate: true`) |
| partial agreement | both currently endorse the same **`partial`**-scope version (pub `policy_partially_accepted_jointly`); remaining disagreements and unaddressed questions stay visible; does not resolve the debate (`branchAgreement`, `packages/domain/policy-view.ts`) |
| no current joint agreement | different versions endorsed, or a formerly joint version lost support by withdrawal (history kept) |

**Branch rules version** (`branch_rule_proposals`, `branch_rule_approvals`, `branch_rule_versions`, migration `0023`; [BRANCH_RULE_VERSIONS.md](../docs/BRANCH_RULE_VERSIONS.md)). Version 1 is the debate's published rules; all three tables are append-only.

| Transition | Actor | Preconditions | Emits | Errors | Tests |
| --- | --- | --- | --- | --- | --- |
| propose (`POST /api/branches/{id}/rules`) | verified branch participant (originator or contender, active account) | `baseRevision` = version in force; response limit 1–7,200 s; reply window 1–720 h or `null`; differs from the rules in force | proposal with database-computed SHA-256 + proposer's own approval; pub `branch_rules_proposed`; audit `branch_rules_proposed` | 404 branch; 403 not a participant; 400 terms or identical; 409 rules changed | `branch-rules.test.ts`, `sequence-rules.db.integration.mjs` |
| accept → next version (`…/rules/{proposalId}/accept`) | the other participant | exact digest; proposal still based on the version in force | approval; when both approved, `branch_rule_versions` row N+1; pub `branch_rules_accepted` or `branch_rules_activated`; audit the same | 400 digest missing; 404; 409 digest mismatch; 409 superseded base | `sequence-rules.db.integration.mjs` |

A new version applies prospectively: later contributions record it and new clocks use its window; earlier contributions keep their version and format status, existing deadlines are not rewritten, other branches are unaffected. Allowed media and the question count cannot be changed this way.

Policy endorsement per (version, candidate), stored as append-only events:

| Transition | Actor | Preconditions | Emits | Errors | Tests |
| --- | --- | --- | --- | --- | --- |
| propose (`POST /api/branches/{id}/policies`) | verified branch participant | 20–50,000 chars; `scope` `full`/`partial` (partial requires remaining disagreements); addressed questions are published questions of the opening or this branch (≤ 50); attachments are published supporting documents of this debate (≤ 20, no duplicates); parent version in the same branch. Scope, questions, notes and attachment digests enter the content digest | pub `policy_version_proposed` (digest, scope, parent, questions, attachment digests) | 403; 400; `23514` `pde_policy_proposer` / `pde_policy_scope` | `public-policy-queries.db.integration.mjs`, `policy-scope.test.ts`, `policy-scope.db.integration.mjs` |
| none/withdrawn → accept (`…/policies/{v}/accept`) | verified branch participant | exact digest matches; not already actively endorsing | `policy_acceptances` (first time) + `policy_endorsement_events` accept; pub `policy_accepted`, `policy_reaffirmed`, `policy_jointly_accepted` (full) or `policy_partially_accepted_jointly` (partial), payload with `scope` and `resolvesDebate` | 404; 409 digest mismatch; 409 already endorsing; `23514` | `policy-endorsement.db.integration.mjs`, `policy-scope.db.integration.mjs` |
| accept → withdrawn (`…/withdraw`) | the endorsing participant | currently endorsing; exact digest | pub `policy_endorsement_withdrawn` (historical acceptance retained) | 409 not endorsing | `policy-endorsement.db.integration.mjs` |

## 7. Derivative

`derivative_artifacts.status`: `draft` → `awaiting_approval` → `approved` → `released`.

| Transition | Actor | Preconditions | Emits | Errors | Tests |
| --- | --- | --- | --- | --- | --- |
| create `draft` (`POST /api/branches/{id}/derivatives`) | verified branch participant | manifest valid (≤ 80 clips, duration budget per output kind); every clip from a published `ready` source on the branch or the opening, within its duration, owned by a participant | none (plan record, manifest SHA-256) | 400; 403; 404 | `rights.test.ts`, `summary.test.ts` |
| edit permission (`POST /api/media/{id}/edit-permissions`) | verified owner of that source | scope names the artifact and a clip range inside the duration | `media_permissions` `edit` row (append-only) | 403 not owner; 400 | `protocol.test.ts` |
| edit permission revoked (`POST /api/media/{id}/edit-permissions/{permissionId}/revoke`) | verified owner who made the grant | grant is optional (`edit` or `distribute`; `archive`/`sequence` are never revocable); not already revoked; optional private reason ≤ 1,000 chars | append-only `media_permission_revocations` row (`revoked_at` set by the database, never backdated); pub `media_permission_revoked` (no reason); audit `media_permission_revoked` | 403 not the granting owner; 409 archive/sequence; 409 already revoked; 400 reason | `permission-revocation.db.integration.mjs` |
| consent incomplete → render queued (`…/render`) | verified branch participant | status `draft`; an **unrevoked** owner `edit` grant covering every clip (`pde_artifact_edit_grants_current`); `RENDER_BUDGET_SECONDS_PER_DAY` not exhausted | `durable_jobs` `render_debate_summary` | 409 missing or revoked grant (names owner and date); 409 already running/completed; 429 render budget exhausted | `media.integration.mjs`, `permission-revocation.db.integration.mjs`, `budget.test.ts` |
| `draft` → `awaiting_approval` | render worker (`npm run worker:render`) | valid lease; sources still `ready` and published; grants still current (also enforced by the `pde_derivative_artifact_grants` trigger) | stores rendered key, output SHA-256, measured duration | job `failed` with retry; 5 attempts max | `media.integration.mjs`, `permission-revocation.db.integration.mjs` |
| approval (`…/approve`) | each verified participant | rendered; submitted SHA-256 equals the rendered output; one approval per candidate; grants still current (`pde_derivative_approval_grants`) | pub `summary_approved`, or `summary_jointly_approved` when both have approved (status `approved`) | 409 not rendered / digest differs / already approved / grant revoked; `23514` `pde_derivative_approver` | `protocol.test.ts` (`mayPublishJointDerivative`), `permission-revocation.db.integration.mjs` |
| `approved` → `released` (`…/release`) | verified participant | both approvals, grants still current, **and** both participants currently endorse the same policy version (full or partial) | pub `summary_released` (records the partial label when the agreement is partial) | 409 | `archive-audit-query.test.mjs`, `permission-revocation.db.integration.mjs`, `policy-scope.db.integration.mjs` |
| `released` → distribution queued (`POST /api/branches/{id}/distributions`) | verified branch participant | artifact `released`, or policy version currently jointly endorsed; 1–10 of the caller's own verified, active `distribution` destinations | one outbox action per destination (public URLs and SHA-256 only, idempotent per destination); audit `distribution_requested`. Delivery states: §8 "Outbox action" | 400; 403 not a participant / foreign or unverified destination; 409 not released / not jointly endorsed | `outbox.db.integration.mjs`, `outbox.test.ts` |

A re-rendered output gets a new SHA-256, so an earlier approval cannot authorize it. A revocation after release leaves the released artifact public with a dated notice; already distributed copies cannot be recalled. Not implemented: `distribute` grants can be revoked but no route creates or consumes them. Distributing a released artifact (`POST /api/branches/{id}/distributions`) re-checks that every edit grant is still unrevoked (409) and that no restriction case is active on it (451); already queued deliveries are not recalled.

## 8. Supporting machines

**Candidacy verification** (`candidacies.verification_status`), with append-only `candidacy_verification_events`:

| Transition | Actor | Preconditions | Emits | Errors |
| --- | --- | --- | --- | --- |
| → `pending` (`POST /api/candidacies`) | signed-in user | known election; one candidacy per account and election | audit `candidacy_requested`; event `submitted` | 404; 409 |
| `unverified`/`pending`/`appealed` → `verified`/`rejected` (`POST /api/admin/candidacies/{id}/verify`) | platform administrator | public procedural reason of 20–2,000 chars | audit `candidate_verification_decision`; event `approved`/`rejected` | 403 not admin; 409 already decided |
| `rejected` → `appealed` (`POST /api/candidacies/{id}/appeal`) | the candidate | statement ≥ 25 chars (kept private) | audit `candidate_verification_appeal`; event `appealed` | 409 |

Tests: the signed-session browser pilot (`scripts/browser-two-candidate-pilot.mjs`, CI job `candidate-pilot`).

**Candidacy withdrawal** (append-only `candidacy_status_events`, migration `0025`; [ACCOUNT_CLOSURE_AND_WITHDRAWAL.md](../docs/ACCOUNT_CLOSURE_AND_WITHDRAWAL.md)):

| Transition | Actor | Preconditions | Emits | Errors | Tests |
| --- | --- | --- | --- | --- | --- |
| active → withdrawn (`POST /api/candidacies/{id}/withdraw`) | the active account owning the candidacy (SQL trigger repeats the ownership check) | `{"confirmation":"WITHDRAW"}`; optional public statement ≤ 1,000 chars; not already withdrawn | `candidacy_status_events` `withdrawn` (shown on the profile and directory with its date); audit `candidacy_withdrawn`. No publication is changed | 400; 403 not the owner; 409 already withdrawn | `restrictions.db.integration.mjs` |

A withdrawn candidacy cannot open debates or publish contributions (`verifiedCandidateSource` and the `publish` variant of `pde_guard_active_actor`); others may still respond to its debates; its open obligations keep their neutral labels. Withdrawal is final.

**Account** (`accounts.status`: `active` → `closed`; `suspended` is refused like `closed` but no flow sets it):

| Transition | Actor | Preconditions | Emits | Errors | Tests |
| --- | --- | --- | --- | --- | --- |
| active → closed (`POST /api/account/close`) | the signed-in account holder | `{"confirmation":"CLOSE MY ACCOUNT"}`; no draft mid-confirmation | in one transaction: private drafts erased (published drafts keep only digest and provenance), remaining private reports and feedback deleted, campaign memberships and delegated roles revoked, status `closed`; audit `account_closed` (counts only) | 400; 404; 409 already closed/suspended; 409 draft confirming | `restrictions.db.integration.mjs` |
| closed → anything / account deleted | nobody | — | — | `pde_guard_account_status`; every authenticated route returns 403; `pde_guard_active_actor` refuses attributed inserts | `restrictions.db.integration.mjs` |

Published contributions, assessments, agreements and candidacy snapshots stay attributed and public. The Neon Auth identity is not deleted.

**Restriction case** (`restriction_cases.status` `active` → `lifted`, with append-only `restriction_events`; migration `0024`; [RESTRICTIONS_AND_APPEALS.md](../docs/RESTRICTIONS_AND_APPEALS.md)). Event order: `opened` → (`appealed` → `upheld`)* → `lifted`; nothing follows `lifted`, and a new restriction needs a new case.

| Transition | Actor | Preconditions | Emits | Errors | Tests |
| --- | --- | --- | --- | --- | --- |
| opened | §1 "visibility restricted" | | | | |
| appealed (`POST /api/restrictions/{id}/appeal`) | account owning the candidacy that published the item (uploader for a document, approving candidacies for a derivative) | case active; no appeal pending; statement 25–4,000 chars (stored only as private basis) | event `appealed`; pub `restriction_appealed` with a fixed notice; audit `restriction_appealed` | 403 not the contributor; 409 lifted / appeal pending; 400 | `restrictions.db.integration.mjs` |
| upheld / lifted (`POST /api/admin/restrictions/{id}/decide`) | platform administrator who is not a participant or delegate in the debate; with more than one admin configured, not the opener | case active; `uphold` only with a pending appeal; public reason | event `upheld`/`lifted` with `independent_review` = decider ≠ opener; `lifted` sets the case status and restores serving immediately; pub `restriction_upheld`/`restriction_lifted`; audit | 403 own case or participant; 404; 409 lifted / no pending appeal | `restrictions.db.integration.mjs`, `restrictions.test.ts` |

Public history: `GET /api/v1/debates/{id}/restrictions` (no account ids, no private basis). "Independent" means a different platform administrator, not an external reviewer.

**Delivery destination** (`delivery_destinations`, migration `0028`; [DISSEMINATION_AND_NOTIFICATIONS.md](../docs/DISSEMINATION_AND_NOTIFICATIONS.md)): one HTTPS webhook or one email address per row, owned by a verified candidacy, at most 10 active; address, kind and secret immutable; never deleted.

| Transition | Actor | Preconditions | Emits | Errors | Tests |
| --- | --- | --- | --- | --- | --- |
| → unverified (`POST /api/destinations`) | verified candidate | valid single address; public-address/SSRF rules for webhooks; not a duplicate | audit `delivery_destination_added`; webhook signing secret returned once | 400; 403; 409 limit or duplicate | `outbox.test.ts`, `outbox.db.integration.mjs` |
| unverified → verified, webhook (`…/verify`) | owner | endpoint answers 2xx echoing the signed challenge | audit `delivery_destination_verified` | 422 verification failed; 409 disabled | `outbox.db.integration.mjs` |
| unverified → verified, email (`…/confirm` from a 72-hour single-use link) | holder of the link (POST behind a button) | email provider configured; token hash matches and unused | audit `delivery_destination_confirmation_queued`, then `delivery_destination_verified` | 410 invalid/used/expired; without a provider no token is created and the destination stays unverified | `outbox.db.integration.mjs` |
| → disabled (`…/disable`) | owner | — | audit `delivery_destination_disabled` | 404 | `outbox.db.integration.mjs` |

An unverified destination cannot be the target of any action except its own confirmation (SQL trigger).

**Outbox action** (`outgoing_actions.state`; shared processor `packages/delivery/outbox-store.ts`): `pending` → `sending` (60 s lease, `SKIP LOCKED`) → `accepted` (email provider 2xx; not proof of delivery) or `delivered` (webhook 2xx) — both terminal and permanent by trigger; or → `failed` (retry with backoff 30 s → 12 h) → … → `dead` after 8 attempts or at once for non-retryable errors (redirect, refused address, 410, disabled destination). `pending` with `last_error=provider_unconfigured` is "Queued — not sent" and never counts as an attempt. Admin requeue of a dead letter (`POST /api/admin/operations/outbox/{id}/retry`, three more attempts, audit `outbox_dead_letter_retried`; 409 if not dead). Processing runs after a request (`after()`), from `/workspace/admin/operations`, or via `npm run worker:outbox`. Tests: `outbox.test.ts`, `outbox.db.integration.mjs`.

**Invitation** (`debate_invitations`, append-only, migration `0029`): created (`POST /api/debates/{id}/invitations`) only by the verified originator of a published debate for a verified same-election candidacy, once per pair (pub `invitation_drafted`, audit `invitation_drafted`; 400 self; 403 not originator; 409 not a verified same-election candidacy). Delivery uses only the invitee's own verified `notifications` destinations; public state is the projection in §5. Invitations never gate participation. Tests: `outbox.test.ts`, `outbox.db.integration.mjs`.

**Campaign membership** (`campaign_memberships`): grant (`POST /api/candidacies/{id}/delegates`, owner only, existing active account, not self; audit `campaign_access_granted`) and one-way revoke (`DELETE …/delegates/{membershipId}`; audit `campaign_access_revoked`). The trigger `pde_guard_campaign_membership` forbids deletion, un-revocation and any other edit.

**Durable job** (`durable_jobs.state`): `queued` → `running` (lease with owner and token) → `completed`, or → `failed` (with `last_error`, retried after backoff; render jobs stop after 5 attempts). An expired lease can be reclaimed; `(job_type, dedupe_key)` is unique, so a retry never duplicates work. Tests: `deadline-worker.test.ts`, `media.integration.mjs`.

**Private assistant data**: erasure (`POST /api/private/drafts/{id}/erase-assessments`) sets `privacy_erased_at` and deletes private reports, never published speech; improvement-consent revocation appends `private_assessment_privacy_events`. Tests: `privacy.db.integration.mjs`.

## 9. Invariants and where they are enforced

| Invariant (plan §8) | Enforcement |
| --- | --- |
| No originator deletion of an opponent's contribution | no delete route; immutability triggers; `schema.test.ts`, `db.integration.mjs` |
| No mutable published question | `pde_questions_guard` |
| No inclusion without reciprocity | `qualifyExchange` (pure, computed on read) |
| No edited output without scoped permission | render precondition + `media_permissions` owner trigger |
| No agreement without both confirmations of the same version | digest-bound endorsement events |
| No candidate/team cross-access | SQL identity proof on every write; private reads filter by account |
| No timeout implying victory | neutral obligation states only |
| No retry duplicating publication or sending | unique draft→submission, job dedupe keys, one continuation per predecessor, one outbox row per destination and dedupe key, terminal `accepted`/`delivered` |
| No successful status without evidence | media `ready` only with scan attestation; documents only with a clean verdict; summaries approved only against rendered bytes; "sent"/"invited" only from provider acceptance; release gate evaluator |
| No suppression by a campaign | restriction cases only by a non-participant platform administrator; the item, counts and sequence position stay |
| No retroactive rule change | branch rule versions apply prospectively; outage extensions never change a fulfilled obligation's timeliness |
