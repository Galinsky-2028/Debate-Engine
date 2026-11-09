# Mutual future rule changes

The opening debate keeps its original rules permanently. Each candidate-to-candidate branch begins at version 1 and may adopt later versions for its own future contributions.

The public debate page shows the current branch rules, proposals, exact SHA-256 digests, participant approvals and activated versions. Either verified branch participant may propose changes to the reciprocal audio/video limit, reply window or allowed media. Both candidates must separately approve the same proposal and digest. Publishing a proposal does not count as an approval. The three-question protocol remains unchanged.

Approvals and activation serialize on the debate and branch. The proposal must name the current base revision; competing proposals based on a superseded revision cannot activate. Retrying the same approval does not create another approval or activation. The database independently rejects third-party approvals, mismatched digests, skipped revisions, cross-branch activation and mutation of proposals, approvals or activated versions.

Each new contribution stores its accepted `rules_version`. The private draft fingerprint includes the version displayed in the response composer. If the rules change before publication, confirmation fails with HTTP 409; the candidate must review the new rules and prepare a fresh draft. The platform does not silently approve different terms on the candidate's behalf. Older drafts without a version are treated as version 1.

New duration/word limits, permitted media and newly opened reply/review clocks use the activated version. Existing submissions, format assessments, original debate rules and existing obligation deadlines remain unchanged. The public API exposes the branch's effective version and each contribution's accepted version.

API endpoints:

- `GET /api/branches/{id}/rules`: current rules and public proposal/approval history.
- `POST /api/branches/{id}/rules`: candidate identity, current `baseRevision`, `maxResponseSeconds`, nullable `replyWindowHours`, and explicit `allowedModalities`.
- `POST /api/branches/{id}/rules/{proposalId}/approve`: candidate identity and exact `sha256`.

The two-candidate browser pilot tests unilateral nonactivation, wrong hashes, impersonation, repeated/concurrent approval, stale drafts, old-clock preservation and publication under version 2. PostgreSQL tests exercise the underlying constraints. Live managed authentication and hosted production operation remain separate checks.
