# Derivative editorial rights — source-aware preliminary implementation

A candidate cannot unilaterally edit an opponent's video. Every editorial proposal has a canonical SHA-256 manifest specifying its source clips, exact in/out points, captions and summary format. The source footage remains intact and independently accessible.

Only the verified owner of an original video may grant an edit scope for a source segment. The grant is linked to the derivative proposal and logged as an append-only permission. A proposed editorial plan is **not** permission to publish an edited video. Before media production and distribution, implement the exact-output checks, both candidates' consent to the final file bytes, and independently verified policy agreement status.

The approved output hash must be the hash of actual rendered media, not merely its edit-plan manifest. This foundation deliberately leaves all artifact statuses in draft to prevent a false grant of rights.

Planned follow-on: render approved storyboard into trial file; validate every segment against its grant; calculate final output SHA-256; require both candidate approvals of that exact output; generate full archive-relative citations, captions and a downloadable press kit.

## Revocation of optional permissions for future uses (PDE-20, migration 0027)

`media_permissions` rows remain immutable grants. A withdrawal is a separate append-only row in `media_permission_revocations` (`permission_id` unique, `candidate_id`, optional private `reason` of at most 1,000 characters, `revoked_at` set by the database and never backdated). The insert trigger permits only the original owner who made the grant, and only for optional grants (`edit`, `distribute`); `archive` and `sequence` permissions given at publication are not revocable (plan 11.2), so the original public record is never affected.

Effects:

- `pde_artifact_edit_grants_current(artifact)` is true only when every clip of the manifest is covered by an **unrevoked** clip-scoped edit grant from the source's owner. `enqueueRender`, `approveRendered`, `releaseSummary` and the render worker treat a revoked grant as absent and fail closed with a message naming the owner and date. Triggers on `derivative_approvals` (insert) and on `derivative_artifacts` status transitions to `awaiting_approval`, `approved` or `released` enforce the same rule in the database.
- An artifact that was already released stays released and downloadable. The workroom and the press kit show a dated note that the owner withdrew permission for future uses; the platform never promises to retrieve copies already distributed. The private reason is shown only to the owner.
- The owner may later make a new, separate grant; the revocation stays in the record.
- A changed manifest (one cut, caption or title) is a different artifact with its own digest and grants; an approval of artifact X cannot be attached to artifact Y (composite foreign key plus the grant trigger).

Endpoints: `GET /api/media/{id}/edit-permissions` (verified owner only: own grants with revocation state and effect) and `POST /api/media/{id}/edit-permissions/{permissionId}/revoke` with optional `{reason}` (same-origin, verified owner, appends a `media_permission_revoked` publication event without the reason and an audit event). The media workroom shows each grant's state and a two-step "Withdraw my editing permission" control.

Tests: `tests/permission-revocation.db.integration.mjs` covers owner-only and optional-only revocation, no backdating, append-only revocations, fail-closed render/approval/release, a refused optional permission leaving the original public, released artifacts staying public with a notice, and one-cut/one-caption changes needing fresh approval. `distribute` grants are revocable but no release path consumes them yet.
