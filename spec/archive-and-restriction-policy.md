# Archive and restriction policy

Normative rules for preserving the public record and for the only process that may limit its visibility. Requirements: plan §14.3 and §17.

## 1. What the archive is

The permanent public record is every published debate, contribution (video, audio or writing), question, answer reference, assessment, objection, correction, supporting document, caption, policy version, endorsement event, released derivative and publication event. "Permanent" is a preservation and access commitment with continuity arrangements, not a promise that one hosting account cannot fail.

## 2. Preservation rules (implemented)

1. **Append-only records.** Published rows and evidence tables refuse UPDATE/DELETE at the database level (`pde_block_any_mutation` and the published-row guards). Corrections, reversals and withdrawals are new linked rows.
2. **Unaltered originals.** Original bytes are stored once in private S3-compatible storage under a unique key with their SHA-256, byte size and scan attestation; a published original cannot be modified or reused. Playback serves the original through a short-lived signed URL; there is no public bucket access.
3. **Integrity evidence.** `GET /api/v1/debates/{id}/integrity` publishes digests; press kits are reproducible ZIPs with a manifest ([PRESS_KITS.md](../docs/PRESS_KITS.md)); `npm run audit:archive:full` re-streams every published object and compares digests ([ARCHIVE_AUDIT.md](../docs/ARCHIVE_AUDIT.md)). A hash shows consistency with stored bytes, not factual truth or authorship.
4. **No candidate suppression.** No route lets a candidate (originator or not) delete, hide, overwrite or de-index another candidate's contribution, and qualification never affects visibility.
5. **Attribution survives.** Contributions reference the candidacy that published them; later withdrawal from an election, party change or account closure does not rewrite attribution.
6. **Backups.** Database and object backups and their restore rehearsals: [backup-and-restore.md](../docs/backup-and-restore.md).

## 3. Exceptional restrictions (normative; implementation in progress)

Only an independently governed platform process may restrict the *visibility* of published material, and only for security, safety or applicable legal requirements. The implementation and its endpoints are documented in [RESTRICTIONS_AND_APPEALS.md](../docs/RESTRICTIONS_AND_APPEALS.md) once merged. The rules it must satisfy:

- **Authority:** platform safety administrators acting under a published policy, never a campaign. Debate originators have no restriction power.
- **Reason categories** fixed in advance; each case records the category, a public notice where permissible and the decision time. The public notice must not republish the harmful material.
- **No deletion.** A restriction changes what is served, not what is retained, except where the law requires removal; in that case only what may lawfully be retained is kept, and the removal itself is recorded.
- **Appeal:** the affected candidate can appeal; the appeal and its decision are appended, never overwritten; reviewers should be independent of the original decision where feasible.
- **Visible placeholder:** counts and the debate structure keep showing that a restricted item exists, so restriction cannot silently change response counts or the qualifying sequence.
- **Audit:** every restriction, appeal and lift is an append-only audit event.

## 4. Account closure and withdrawal (normative; implementation in progress)

Closing an account or withdrawing from an election ends future actions, revokes delegate grants and handles private account data, but never removes published contributions or rewrites their attribution. Details: [ACCOUNT_CLOSURE_AND_WITHDRAWAL.md](../docs/ACCOUNT_CLOSURE_AND_WITHDRAWAL.md).

## 5. Private material

Private drafts, Debate Assistant reports, verification appeal statements and account data are not part of the archive. They can be erased under their own controls ([ASSESSMENT_ERASURE.md](../docs/ASSESSMENT_ERASURE.md), [PRIVATE_PRIVACY_CONTROLS.md](../docs/PRIVATE_PRIVACY_CONTROLS.md)) without touching published evidence.

## 6. Budget pressure

When storage or processing budgets are exhausted, new optional work (derivatives, hosted preparation) pauses with an honest message; published originals are never deleted to save money. See [OPERATIONS_AND_COST_CONTROLS.md](../docs/OPERATIONS_AND_COST_CONTROLS.md).
