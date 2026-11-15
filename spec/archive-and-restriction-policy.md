# Archive and restriction policy

Normative rules for preserving the public record and for the only process that may limit its visibility. Requirements: plan §14.3 and §17.

## 1. What the archive is

The permanent public record is every published debate, contribution (video, audio or writing), question, answer reference, assessment, objection, correction, supporting document, caption, policy version, endorsement event, released derivative, published sequence revision, branch rule version, outage extension, restriction event, candidacy withdrawal event and publication event. "Permanent" is a preservation and access commitment with continuity arrangements, not a promise that one hosting account cannot fail.

## 2. Preservation rules (implemented)

1. **Append-only records.** Published rows and evidence tables refuse UPDATE/DELETE at the database level (`pde_block_any_mutation` and the published-row guards). Corrections, reversals and withdrawals are new linked rows.
2. **Unaltered originals.** Original bytes are stored once in private S3-compatible storage under a unique key with their SHA-256, byte size and scan attestation; a published original cannot be modified or reused. Playback serves the original through a short-lived signed URL; there is no public bucket access.
3. **Integrity evidence.** `GET /api/v1/debates/{id}/integrity` publishes digests; press kits are reproducible ZIPs with a manifest ([PRESS_KITS.md](../docs/PRESS_KITS.md)); `npm run audit:archive:full` re-streams every published object and compares digests ([ARCHIVE_AUDIT.md](../docs/ARCHIVE_AUDIT.md)). A hash shows consistency with stored bytes, not factual truth or authorship.
4. **No candidate suppression.** No route lets a candidate (originator or not) delete, hide, overwrite or de-index another candidate's contribution, and qualification never affects visibility.
5. **Attribution survives.** Contributions reference the candidacy that published them; later withdrawal from an election, party change or account closure does not rewrite attribution.
6. **Backups.** Database and object backups and their restore rehearsals: [backup-and-restore.md](../docs/backup-and-restore.md).

## 3. Exceptional restrictions (normative; implemented)

Only a separate platform process may restrict the *visibility* of published material, and only for security, safety or applicable legal requirements. Implementation: migration `0024_restriction_cases.sql`, `lib/server/restrictions.ts`, `packages/domain/restrictions.ts`; endpoints and UI in [RESTRICTIONS_AND_APPEALS.md](../docs/RESTRICTIONS_AND_APPEALS.md); transitions in [state-machine.md §8](state-machine.md#8-supporting-machines). Tests: `restrictions.db.integration.mjs` (real migrated SQL and production query strings), `restrictions.test.ts`.

- **Authority:** platform administrators (`PLATFORM_ADMIN_USER_IDS`), never a campaign. The database refuses an opener or decider who owns a participating candidacy in that debate or holds an active campaign membership for one. Debate originators have no restriction power.
- **Targets:** a published submission, supporting document or released derivative. A released derivative is also treated as restricted while any of its clip sources is restricted.
- **Reason categories** fixed in the schema: `malware_or_security`, `unlawful_content`, `private_information`, `legal_order`, `impersonation`. Each case records the category, a 20–1,000-character public notice and the decision times. The notice may not share a run of six consecutive words with the restricted material or the private basis (a heuristic; administrators must still write notices carefully).
- **No deletion.** A restriction changes what is served (HTTP 451 on play, captions, document and derivative download/preview; `written_content: null` in public reads; skipped by search; withheld filename in press kits), not what is retained. Nothing in `submissions`, `submission_documents` or `derivative_artifacts` is updated or deleted. *Not implemented:* a lawful-removal path that deletes stored bytes and records the removal; it would need its own reviewed process.
- **Appeal:** the account that owns the publishing candidacy can appeal once at a time; the statement stays private and a fixed public notice is shown. Appeals, upholds and lifts are appended, never overwritten. With more than one administrator configured, the opener cannot decide their own case; `independent_review` records truthfully whether the decider differs from the opener. This is not an external review.
- **Visible placeholder:** the item's row, attribution, date, counts and qualifying-sequence position stay; the page shows the category, date, notice and appeal status in its place.
- **Audit:** every opening, appeal, uphold and lift is an append-only `restriction_events` row, a public `publication_events` row without account ids or private basis, and an `audit_events` row. Public history: `GET /api/v1/debates/{id}/restrictions`. Lifting is final for that case and restores serving immediately.
- **Known gaps:** question texts, answers, corrections and assessments attached to a restricted submission stay visible (no separate target kind); object-storage URLs signed before a restriction remain valid for up to 300 seconds; HTTP-level route tests with real Neon Auth sessions are not automated.

## 4. Account closure and withdrawal (normative; implemented)

Closing an account (`POST /api/account/close`) erases private drafts and reports, revokes delegate grants and memberships, and sets the account to `closed`; withdrawing a candidacy (`POST /api/candidacies/{id}/withdraw`) appends a public, final withdrawal event. Neither removes a published contribution or rewrites its attribution: the profile shows "Withdrew from this election on <date>", and a closed account's publications stay in every public query. Closed (and suspended) accounts are refused on every authenticated route and by `pde_guard_active_actor` insert triggers (`0025`). Details and limits: [ACCOUNT_CLOSURE_AND_WITHDRAWAL.md](../docs/ACCOUNT_CLOSURE_AND_WITHDRAWAL.md); tests in `restrictions.db.integration.mjs`. Platform administrators may suspend and reinstate an account (migration `0035`, `/workspace/admin/accounts`); suspension stops the account from acting but never removes, hides or rewrites a published contribution, and each step is an append-only event with a public notice. The Neon Auth sign-in identity is not deleted by closure.

## 5. Private material

Private drafts, Debate Assistant reports, verification appeal statements and account data are not part of the archive. They can be erased under their own controls ([ASSESSMENT_ERASURE.md](../docs/ASSESSMENT_ERASURE.md), [PRIVATE_PRIVACY_CONTROLS.md](../docs/PRIVATE_PRIVACY_CONTROLS.md)) without touching published evidence.

## 6. Budget pressure

Operator-set caps (`MEDIA_STORAGE_BUDGET_BYTES`, `RENDER_BUDGET_SECONDS_PER_DAY`) are checked before new work: an exhausted storage budget refuses new uploads (HTTP 507) and an exhausted render budget pauses new optional renders until the next UTC day (HTTP 429), each with an honest message reported by `/api/capabilities`. A budget check never deletes anything; published originals are never deleted to save money (`budget.test.ts`). See [OPERATIONS_AND_COST_CONTROLS.md](../docs/OPERATIONS_AND_COST_CONTROLS.md).
