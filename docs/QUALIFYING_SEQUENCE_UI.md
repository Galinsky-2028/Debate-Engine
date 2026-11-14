# Public qualifying sequence and its published revisions

The complete public record and the qualifying sequence remain separate. Every published contribution stays in the complete record whether or not it qualifies. Each branch shows the unedited source contributions of its qualifying sequence; pending and disputed exchanges remain footnoted with links to their complete public records.

## Versioned manifests (PDE-13)

`qualifying_sequence_manifests` (migration `0021`) stores, per branch, a monotonically increasing `revision`, the exact ordered `submission_ids` (opening + complete exchange units, so always an odd count of at least three), a database-computed `manifest_sha256` over the comma-joined UUIDs, and the publication time.

- **Materialized in the same transaction** as the continuation publication (`lib/server/continue-debate.ts`) or attributed assessment (`app/api/assessments/route.ts`) that makes a new completed exchange unit qualify (`lib/server/sequence-manifests.ts`). A `qualifying_sequence_published` publication event accompanies each revision. Readers never create history.
- **Append-only.** Updates and deletes are refused. A new revision must extend the previous revision's exact prefix with complete exchanges; truncation, replacement, repetition, wrong-branch entries and skipped revisions are refused by the database trigger.
- **Independent database validation** of appended exchanges: published opening first, alternating contender/originator parent chain on the branch, no recorded format issue, every posed question answered in the next contribution and accepted by its questioner (latest decision), and the owner's `sequence` permission on any media original. A contender's closing turn that asks no new question can qualify once the originator accepts its answers and replies. If the trigger ever disagrees with the projection, the publication or assessment still succeeds (savepoint) and the page keeps showing the latest published revision.
- **A later reversal does not delete a published revision.** Earlier revisions are passed to `branchSequence` as a preserved prefix, so a reassessment is visible in the complete record but cannot remove an exchange that was already published; new completed exchanges may still extend the sequence.
- **Assessment order.** Migration `0022` adds an insertion-ordered `event_order` to assessments, so two decisions with the same timestamp (one transaction) or legacy UUID ordering cannot reorder a questioner's later decision. Legacy rows keep timestamp/UUID order and sort before ordered rows.

## Public reads

- The debate page shows "Published sequence revision N" (or "Current assessment projection" when none exists yet) and a history listing every revision, its contributions and digest.
- `GET /api/debates/{id}/sequence` returns per branch `qualifyingSubmissionIds` (the latest published revision, else the projection), `currentProjectionSubmissionIds`, `publishedRevision`, the branch `rulesVersion`, and all `manifests` (newest first). `/api/debates/{id}` and `/api/v1/debates/{id}` include `sequenceManifests`.

Tested by `tests/sequence.test.ts` (prefix preservation, B1 never alone, event ordering) and `tests/sequence-rules.db.integration.mjs` (A0/B1/A2 → revision 1 exactly; B1 alone never; reversal leaves revision 1; update/delete/forged/wrong-branch inserts refused; revision 2 extends the prefix after a reversal).

Limits: no backfill of legacy branches was performed; they show the current projection until their next qualifying publication or assessment. The digest is an integrity checksum, not a digital signature or independent attestation; independent copyright authorization remains a later gate.
