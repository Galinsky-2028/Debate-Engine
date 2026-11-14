# State machine

Derived from the migrations in `packages/database/migrations/`, the server modules in `lib/server/`, the workers in `scripts/` and the tests in `tests/`, as of 2026-11-14. The plan (section 8) requires independent state dimensions rather than one overloaded status; this file lists each dimension, how it is stored, and every implemented transition with its actor, preconditions, emitted events, errors and covering tests. Rows marked **planned** are required by the plan but not implemented in this tree; the linked document is where the work that adds them describes it.

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
| `reviewed` → `confirming` → `published` (`POST …/confirm`) | draft owner | submitted SHA-256 equals current fingerprint; preliminary assessment for that fingerprint *or* explicit skip; `archiveConsent` and `sequenceConsent` true; then all rules of `publishOpening` / `publishContinuation` | opening: pub `debate_opened`, audit `debate_published`. Continuation: pub `contribution_published` (with `formatIssues`), audit `contribution_published`, reply/review obligations and deadline jobs (§5) | 409 fingerprint changed; 409 not reviewed; 400 consents missing; 400 medium/rules/anchors invalid; 404 parent not published; 409 predecessor already continued or first response exists; 409 media already used; 403 not a branch participant | `confirmation.test.ts`, `full-debate-pilot.db.integration.mjs`, `multimodal.db.integration.mjs`, `format.test.ts` |
| stuck `confirming` recovery | draft owner | an existing submission with `origin_draft_id` wins; otherwise retry only after the 5-minute window (`mayRecoverConfirmation`) | none new; no second publication (unique `submissions_one_publication_per_draft`) | 409 still in progress | `confirmation.test.ts` |
| published → modified/deleted | nobody | — | — | `55000` from `pde_published_submissions_immutable`, `pde_published_debates_immutable`, question/answer/media guards | `db.integration.mjs`, `schema.test.ts` |
| correction appended (`POST /api/contributions/{id}/corrections`) | verified author of the contribution | contribution and debate published; 20–5,000 characters | pub `source_correction_published`, audit `source_correction_published` | 403 not author; `23514` from `pde_correction_author` | `corrections.db.integration.mjs` |
| supporting document appended (`POST /api/contributions/{id}/documents`) | verified author | published contribution; PDF/DOCX/text by content sniffing; ≤ 20 MiB | pub `supporting_document_published` | 403; 413; 415 | `archive-integrity.test.mjs` |
| caption published (`POST /api/media/{id}/captions`) | verified owner of the original | valid WebVTT within the media duration | `media_captions` row (append-only) | 400; 403 | `captions.test.ts` |
| published → exceptionally restricted | independent restriction process | **planned** — [RESTRICTIONS_AND_APPEALS.md](../docs/RESTRICTIONS_AND_APPEALS.md) | | | |

## 2. Media

Three stored machines feed one public fact: a `media_assets` row in `ready`.

**Upload session** (`media_upload_sessions.status`):

| Transition | Actor | Preconditions | Emits | Errors | Tests |
| --- | --- | --- | --- | --- | --- |
| → `uploading` (`POST /api/media/uploads`) | verified candidate | scanner online (`requireScannerPreflight`); declared size 64 B–60 MiB; 8 MiB parts; SHA-256 declared; hosted preparation only with a stored `paid` tier | none | 503 scanner offline (no S3 session created); 400; 403 | `uploads.db.integration.mjs`, `upload-parts.test.ts` |
| part upload (`PUT …/parts/{n}`) | session owner | `uploading`, not expired, exact byte range | none | 409 not accepting; 400 wrong range | `upload-parts.test.ts` |
| `uploading` → `finalizing` → `completed` (`POST …/complete`) | session owner | stored size and SHA-256 equal the declaration; scanner verdict `clean`; FFprobe container matches medium | inserts `media_assets` (`ready`) + `media_scan_attestations`; audit `media_validated` | 422 size/hash mismatch or detected; 415 wrong medium; 503 scanner pending (session stays `finalizing`, resumable) | `uploads.db.integration.mjs`, `scan-attestation.db.integration.mjs` |
| `finalizing` → `failed` | system | validation error 413/415/422 | none | — | `uploads.db.integration.mjs` |
| `uploading` → `aborted` (`DELETE …/{id}` or expiry cleanup) | owner, or `npm run worker:uploads:cleanup` | only `uploading`; finalizing/completed originals are never deleted this way | none | 409 finalized | `upload-maintenance.test.mjs` |

**Scan job** (`media_scan_jobs.status`, operator-laptop mode `PDE_SCANNER_MODE=pull`): `pending` → leased by the paired worker (`claimScan`, 2-minute lease, heartbeat) → `clean` or `detected`; an `unavailable` report releases the lease. Actor: the paired scanner (Bearer token ≥ 64 chars, constant-time compare). Errors: 401 unpaired; 409 lease expired/reused/digest mismatch. Tests: `laptop-scanner.db.integration.mjs`, `laptop-scanner.http.integration.mjs`, `laptop-worker.test.ts`, `clamav*.test.ts`. In hosted mode the web process scans through the local `clamd` socket instead.

**Media asset** (`media_assets.processing_status`): the application only ever inserts `ready`, after hashing, scanning and probing; a rejected file never becomes an asset. The schema values `quarantined`, `validating` and `rejected` are reserved. Playback serves a short-lived signed URL to the unaltered original; separate playback encodes and a `degraded` state are **planned** with the hosted media worker ([WORKER_SAFETY_AND_OPERATIONS.md](../docs/WORKER_SAFETY_AND_OPERATIONS.md)). A `ready` asset used by a published submission cannot be modified (`pde_media_guard`) or reused (`pde_one_submission_per_source`).

## 3. Assessment

Per (question, answering submission). No stored status column: the state is the latest `assessments` row.

| Transition | Actor | Preconditions | Emits | Errors | Tests |
| --- | --- | --- | --- | --- | --- |
| awaiting review → `answered` / `partly_answered` / `not_answered` / `disputed_premise` (`POST /api/assessments`) | verified candidate who asked the question | answer is the immediately following, published opponent contribution in the same debate; reason 1–4,000 chars | pub `question_assessed`; fulfils the matching review obligation | 400 unsupported decision; 403 not your question; `23514` from `pde_guard_assessment` | `protocol.test.ts`, `sequence.test.ts`, `full-debate-pilot.db.integration.mjs`, `obligation-wiring.test.ts` |
| reversal | same questioner | new row with `supersedes_assessment_id` = previous latest for the same question/answer/reviewer | pub `question_assessed` | `23514` mismatched reversal | `sequence.test.ts` |
| objection (`POST /api/assessment-objections`) | verified author of the assessed contribution | assessment exists on their published contribution; optional non-negative timestamp | pub `assessment_objected` | 403; `23514` from `pde_objection_author` | `full-debate-pilot.db.integration.mjs` |

For qualification only `answered` counts as accepted; every other judgment is "not accepted". Assessments and objections are append-only.

## 4. Inclusion

Computed on read by `branchSequence` (`packages/domain/sequence.ts`) over the immutable record; nothing is stored, so nothing can be edited to fake inclusion. States per exchange unit: `awaiting_originator_assessment`, `footnoted`, `footnoted_format`, `awaiting_originator_answer`, `awaiting_responder_assessment`, `reciprocity_disputed`, `qualified` (meanings in [debate-protocol.md §5](debate-protocol.md#5-reciprocal-exchange-units)). A published contribution that is not in `qualifyingSubmissionIds` is "public only". Read via `GET /api/debates/{id}/sequence` and the debate page. Tests: `protocol.test.ts`, `sequence.test.ts`, `format.test.ts`, `multimodal.db.integration.mjs`, `full-debate-pilot.db.integration.mjs`.

Persisted versioned sequence manifests (`sequence_versions`/`sequence_entries` exist in the schema but are unused) are **planned** — [BRANCH_RULE_VERSIONS.md](../docs/BRANCH_RULE_VERSIONS.md).

## 5. Obligation

`reply_obligations` (`obligation_type` `review` or `reply`), with `opened_at`, `due_at`, `received_at`, `processed_at`, plus append-only `obligation_outage_adjustments`. The state is projected (`projectObligation`, and the same CASE expression in `lib/server/public-debates.ts`):

| Transition | Actor | Preconditions | Emits | Errors | Tests |
| --- | --- | --- | --- | --- | --- |
| → `open` | system, inside the publication transaction of a continuation | continuation answers questions → review obligation for the questioner; asks questions → reply obligation for the opponent; `due_at` = publication + reply window (none if unlimited) | `durable_jobs` row `obligation_deadline` keyed by obligation and due time | unique key makes it idempotent | `obligation-wiring.test.ts` |
| `open` → `fulfilled_on_time` / `fulfilled_late` | system | reply: the obligated candidate publishes the continuation; review: the questioner records an assessment. Compared with the effective due time | carried by the triggering pub event | — | `deadlines.test.ts`, `obligation-wiring.test.ts` |
| `open` → `overdue` | time; `npm run worker:deadlines` | effective due (due + Σ adjustments) passed with no receipt | pub `obligation_overdue` once per obligation; no external message | leased, `SKIP LOCKED`, re-queues if an adjustment moved the due time | `deadline-worker.test.ts` |
| `overdue` → `fulfilled_late` | obligated candidate | late publication/assessment | as above | — | `deadlines.test.ts` |
| outage adjustment added | authorized operator | **planned** API — [BRANCH_RULE_VERSIONS.md](../docs/BRANCH_RULE_VERSIONS.md); the table and projection exist | | | `deadlines.test.ts` (projection) |
| superseded by recorded agreement | — | **planned** | | | |
| invitation clock | — | **planned** — [INVITATIONS.md](../docs/INVITATIONS.md); `invitedReplyOpenedAt` already refuses to open a clock without provider evidence | | | `deadlines.test.ts` |

The deadline worker is a CLI; on the current free deployment nothing runs it on a schedule. Overdue labels shown by public reads are computed from the clock and stay correct without it.

## 6. Branch

`debate_branches` has no status column; branch state is derived.

| State | Derivation |
| --- | --- |
| awaiting response | debate published, no branch row for a contender yet |
| active | branch exists (created atomically by the contender's first published response, one per contender) |
| inactive | an open obligation is `overdue` (neutral label; never a concession) |
| resolution proposed | a `policy_versions` row exists for the branch (pub `policy_version_proposed`) |
| resolved | both participants' latest `policy_endorsement_events` for the same version are `accept` (pub `policy_jointly_accepted`) |
| partial agreement | **planned** (PDE-19) |

Policy endorsement per (version, candidate), stored as append-only events:

| Transition | Actor | Preconditions | Emits | Errors | Tests |
| --- | --- | --- | --- | --- | --- |
| propose (`POST /api/branches/{id}/policies`) | verified branch participant | 20–50,000 chars; parent version in the same branch | pub `policy_version_proposed` | 403; 400; `23514` `pde_policy_proposer` | `public-policy-queries.db.integration.mjs` |
| none/withdrawn → accept (`…/policies/{v}/accept`) | verified branch participant | exact digest matches; not already actively endorsing | `policy_acceptances` (first time) + `policy_endorsement_events` accept; pub `policy_accepted`, `policy_reaffirmed` or `policy_jointly_accepted` | 404; 409 digest mismatch; 409 already endorsing; `23514` | `policy-endorsement.db.integration.mjs` |
| accept → withdrawn (`…/withdraw`) | the endorsing participant | currently endorsing; exact digest | pub `policy_endorsement_withdrawn` (historical acceptance retained) | 409 not endorsing | `policy-endorsement.db.integration.mjs` |

## 7. Derivative

`derivative_artifacts.status`: `draft` → `awaiting_approval` → `approved` → `released`.

| Transition | Actor | Preconditions | Emits | Errors | Tests |
| --- | --- | --- | --- | --- | --- |
| create `draft` (`POST /api/branches/{id}/derivatives`) | verified branch participant | manifest valid (≤ 80 clips, duration budget per output kind); every clip from a published `ready` source on the branch or the opening, within its duration, owned by a participant | none (plan record, manifest SHA-256) | 400; 403; 404 | `rights.test.ts`, `summary.test.ts` |
| edit permission (`POST /api/media/{id}/edit-permissions`) | verified owner of that source | scope names the artifact and a clip range inside the duration | `media_permissions` `edit` row (append-only) | 403 not owner; 400 | `protocol.test.ts` |
| consent incomplete → render queued (`…/render`) | verified branch participant | status `draft`; an owner `edit` grant covering every clip | `durable_jobs` `render_debate_summary` | 409 missing grant; 409 already running/completed | `media.integration.mjs` |
| `draft` → `awaiting_approval` | render worker (`npm run worker:render`) | valid lease; sources still `ready` and published | stores rendered key, output SHA-256, measured duration | job `failed` with retry; 5 attempts max | `media.integration.mjs` |
| approval (`…/approve`) | each verified participant | rendered; submitted SHA-256 equals the rendered output; one approval per candidate | pub `summary_approved`, or `summary_jointly_approved` when both have approved (status `approved`) | 409 not rendered / digest differs / already approved; `23514` `pde_derivative_approver` | `protocol.test.ts` (`mayPublishJointDerivative`) |
| `approved` → `released` (`…/release`) | verified participant | both approvals **and** a currently jointly accepted policy on the branch | pub `summary_released` | 409 | `archive-audit-query.test.mjs` (released files enter the audit) |
| `released` → distributed | **planned** — [DISSEMINATION_AND_NOTIFICATIONS.md](../docs/DISSEMINATION_AND_NOTIFICATIONS.md) (`outgoing_actions` exists, unused) | | | | |

A re-rendered output gets a new SHA-256, so an earlier approval cannot authorize it.

## 8. Supporting machines

**Candidacy verification** (`candidacies.verification_status`), with append-only `candidacy_verification_events`:

| Transition | Actor | Preconditions | Emits | Errors |
| --- | --- | --- | --- | --- |
| → `pending` (`POST /api/candidacies`) | signed-in user | known election; one candidacy per account and election | audit `candidacy_requested`; event `submitted` | 404; 409 |
| `unverified`/`pending`/`appealed` → `verified`/`rejected` (`POST /api/admin/candidacies/{id}/verify`) | platform administrator | public procedural reason of 20–2,000 chars | audit `candidate_verification_decision`; event `approved`/`rejected` | 403 not admin; 409 already decided |
| `rejected` → `appealed` (`POST /api/candidacies/{id}/appeal`) | the candidate | statement ≥ 25 chars (kept private) | audit `candidate_verification_appeal`; event `appealed` | 409 |

Tests: the signed-session browser pilot (`scripts/browser-two-candidate-pilot.mjs`, CI job `candidate-pilot`). Withdrawal from an election and account closure are **planned** — [ACCOUNT_CLOSURE_AND_WITHDRAWAL.md](../docs/ACCOUNT_CLOSURE_AND_WITHDRAWAL.md); `accounts.status` (`active`/`suspended`/`closed`) exists but no flow writes it.

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
| No retry duplicating publication or sending | unique draft→submission, job dedupe keys, one continuation per predecessor |
| No successful status without evidence | media `ready` only with scan attestation; summaries approved only against rendered bytes; release gate evaluator |
