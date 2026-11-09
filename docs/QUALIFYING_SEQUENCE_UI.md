# Public qualifying sequence and history

The complete public record and the qualifying sequence remain separate. Every branch displays the unedited source contributions in its published qualifying sequence. Pending and disputed contributions remain linked to their complete public records.

Completed reciprocal exchanges are now materialized transactionally when a continuation or an attributed assessment completes qualification. `qualifying_sequence_manifests` stores the branch, monotonically increasing revision, exact ordered submission IDs, publication time and a database-computed SHA-256 digest. The digest covers the UTF-8 comma-separated ordered UUIDs. The referenced submissions and original media metadata already have immutable-publication guards; this is an integrity digest, not an independent digital signature or storage audit.

Database triggers enforce the opening, branch ownership, alternating parent chain, complete reciprocal answer mappings, both questioners' current approvals for newly appended exchanges, qualifying format and original-owner sequence permissions. Revisions may only append complete exchanges to the previous published prefix. Updates, deletions, truncation, replacement, wrong-branch entries and incomplete exchanges are rejected.

A later attributed reassessment cannot remove an already published exchange. It remains visible alongside the original assessment and any objections. New completed exchanges may extend the preserved prefix even if a participant later disputes an older answer. The public page exposes each historical version and its contribution links. `GET /api/debates/{id}/sequence` distinguishes published sequence IDs from the current assessment projection and returns the versioned manifests.

Legacy branches without a saved version are explicitly labeled as a current assessment projection. No past manifest is invented or backdated. A later qualifying publication/assessment records the currently eligible sequence. No production backfill was performed.

Assessments inserted after migration 0020 have a monotonically increasing event order. Legacy assessments retain their existing timestamp/UUID ordering. This prevents same-timestamp decisions and PostgreSQL Date values from incorrectly reordering an author's later assessment.
