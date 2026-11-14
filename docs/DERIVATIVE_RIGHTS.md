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

Tests: `tests/permission-revocation.db.integration.mjs` covers owner-only and optional-only revocation, no backdating, append-only revocations, fail-closed render/approval/release, a refused optional permission leaving the original public, released artifacts staying public with a notice, and one-cut/one-caption changes needing fresh approval. Distribute grants are covered below.

## Separate distribution permission (plan 11.2 and 12, migration 0033)

Approving an edit is not permission to distribute the result. A released summary can be distributed only when the owner of **every** source video in its manifest has a current (unrevoked) `distribute` grant for that artifact, in addition to unrevoked `edit` grants and no active restriction.

- `POST /api/media/{id}/distribute-permissions` `{candidacyId, scope:{artifactId}}` (same-origin, verified owner proven in SQL): the video must be a published source on the artifact's branch or the opening, and the artifact's manifest must use it. A second current grant for the same artifact is refused (409). Appends `media_distribution_permission_granted` (publication) and an audit event. `GET` lists the owner's own distribute grants; `GET /api/media/{id}/edit-permissions` lists edit and distribute grants together.
- Withdrawal: `POST /api/media/{id}/distribute-permissions/{permissionId}/revoke` (or the edit-permissions revoke route), the same append-only `media_permission_revocations` row as for edit grants.
- Database: `pde_distribute_permission_scope` (insert trigger: `scope.artifactId` must name a summary that uses this video; an optional clip range must be valid), `pde_artifact_distribute_grant_status(artifact)` (per source video: owner and `current`/`withdrawn`/`missing`; a clip-scoped grant counts only if it covers every clip of that video), `pde_artifact_distribute_grants_current(artifact)`, and `pde_summary_distribution_grants` (refuses any `distribution` outbox action for a `derivative_artifact` without current edit and distribute grants).
- `requestDistribution` fails closed with 409 naming each owner who "has not granted" or "withdrew" distribution permission. The outbox processor re-checks at send time, so a queued delivery is not sent after a withdrawal (state `dead`, nothing handed to a provider). Copies already accepted or delivered cannot be recalled.
- Policy press-kit links carry no source media and need no distribute grant.
- UI: the media workroom shows, per artifact and source video, "Distribution permission granted / not granted / withdrawn", a grant button for the owner and a two-step withdraw control, and for a released summary which owner's permission is missing. `GET /api/branches/{id}/distributions` returns `summaryPermissions` (owner names and states per released summary).

Tests: `tests/distribute-permission.db.integration.mjs` (non-owner and wrong-artifact grants refused in the server core and by triggers; edit grants alone insufficient; one owner's grant insufficient; revoked distribute blocks; a fresh grant restores; a revoked edit grant still blocks; clip-scoped coverage; policy distribution unaffected; queued delivery not sent after withdrawal) and `tests/obligation-closure-and-grants.test.ts` (owner-naming message).
