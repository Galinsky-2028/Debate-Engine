# Permission and consent model

Who may do what, and which consents are separate. Normative; enforcement points are named so a reviewer can check them. Transitions and errors are in [state-machine.md](state-machine.md).

## 1. Identity and authority

| Role | How it is established | May | May never |
| --- | --- | --- | --- |
| Visitor | none | read everything published (pages, `/api/v1/**`, feed, search, embeds, press kits) | read drafts, private notes, verification evidence, account ids, emails |
| Signed-in user | Neon Auth session (Google or verified email) | register a candidacy; read own account | act as a candidate before verification |
| Verified candidate | candidacy `verified` **and** the session subject owns the candidacy's account, checked in SQL on every write | draft/publish own contributions; assess answers to own questions; object to assessments of own contributions; correct own contributions; propose/accept/withdraw policy on own branches; grant and revoke optional rights over own media; approve joint outputs on own branches; propose/accept branch rule changes on own branches; invite same-election candidates to own debates; register own delivery destinations and distribute released outputs of own branches to them; appeal a restriction of own material; withdraw own candidacy | edit, hide or delete anyone's published record; assess someone else's question; approve for another candidate; grant rights over another's media |
| Campaign delegate (`editor`, `publisher`) | granted by the candidacy owner (`campaign_memberships`, named grantor required) | be listed with an auditable grant | publish candidate speech, accept agreements, grant media rights, verify candidacies (no route accepts a delegate for these) |
| Platform administrator | Auth user id in `PLATFORM_ADMIN_USER_IDS` (never an email match), active account | decide candidacy verification with a public reason; pair the operator scanner; add documented outage extensions; run pending jobs and requeue dead letters (`/workspace/admin/operations`); open, uphold or lift restriction cases in debates where they own no participating candidacy and hold no campaign membership for one (`0024`, `restrictions.db.integration.mjs`) | debate adjudication; edit or delete contributions; restrict in a debate they participate in; decide their own case when another admin is configured |
| Paired scanner | `SCANNER_WORKER_TOKEN` (≥ 64 chars) held by the platform operator | claim scan jobs, report verdicts bound to a digest and lease | read the database or storage credentials; publish |

A client-supplied candidacy id is never sufficient. Mutations also require a trusted same-origin request (`packages/domain/request-origin.ts`, `request-origin.test.ts`). Database triggers repeat the ownership rules as defense in depth (`0007_actor_integrity.sql`, `0014`, `0016`, `0017`; [DATABASE_INTEGRITY.md](../docs/DATABASE_INTEGRITY.md)).

## 2. Separate media permissions

Plan §2.2 and §11.2 require that archival publication, qualifying inclusion and editing are different permissions. `media_permissions` (append-only, owner-only by trigger) stores them per original:

| Permission | Granted by | When | Scope |
| --- | --- | --- | --- |
| `archive` | the original's owner | at publication, only if the draft's `archiveConsent` is true | full unedited public archive and download |
| `sequence` | the original's owner | at publication, only if `sequenceConsent` is true | unedited inclusion in the qualifying sequence |
| `edit` | the original's owner | separately, per derivative artifact (`POST /api/media/{id}/edit-permissions`) | exact `artifactId` and clip range; nothing else |
| `distribute` | — | **not implemented**: the value exists in the schema and a grant would be revocable (`0027`), but no route creates one and no release or distribution path consumes it | |

Publication cannot proceed without both `archiveConsent` and `sequenceConsent` (`confirm-private-publication.ts`). An archive permission never implies an edit permission. Distribution of a released summary or a jointly endorsed policy ([DISSEMINATION_AND_NOTIFICATIONS.md](../docs/DISSEMINATION_AND_NOTIFICATIONS.md)) is authorized by the branch participant who requests it, to their own verified destinations, and relies on the release conditions in §3, not on a `distribute` grant. Written contributions have no media asset; their content is published under the same draft consents.

## 3. Joint derivative outputs

1. A participant drafts an editorial manifest of exact clips (`derivative_artifacts`, manifest SHA-256).
2. Every source owner grants an `edit` permission covering each of their clips for that artifact. Rendering is refused otherwise.
3. The worker renders deterministic bytes and records the output SHA-256.
4. Both participants approve that exact SHA-256 (`derivative_approvals`, trigger requires the rendered digest).
5. Release additionally requires that both participants currently endorse the same policy version on the branch; a partial agreement is labelled as partial in the release event and press kit.
6. Rendering, approval and release each re-check that every edit grant is unrevoked (`pde_artifact_edit_grants_current`, application checks and triggers on `derivative_approvals` and `derivative_artifacts`).

A new cut, title or caption produces new bytes and a new digest; earlier approvals do not carry over. Nobody can approve another candidate's clips. A withheld approval leaves the summary unreleased and never affects the policy agreement or the original record. Tests: `protocol.test.ts` (`mayPublishJointDerivative`), `rights.test.ts`, `summary.test.ts`, `media.integration.mjs`, `permission-revocation.db.integration.mjs`.

## 4. Policy agreement consent

Acceptance binds to a version id **and** its content digest, which covers scope, addressed questions, notes and attachment digests. Joint agreement means both participants' latest endorsement events for the same version are `accept`; for a `partial` version it is reported only as partial agreement. Withdrawal is a new event; history is kept ([POLICY_CONVERGENCE.md](../docs/POLICY_CONVERGENCE.md), `policy-endorsement.db.integration.mjs`, `policy-scope.db.integration.mjs`).

Branch rule changes use the same pattern: a proposal is bound to its database-computed digest and takes effect only when the other participant accepts that exact digest; the proposer's own acceptance alone has no effect ([BRANCH_RULE_VERSIONS.md](../docs/BRANCH_RULE_VERSIONS.md), `sequence-rules.db.integration.mjs`).

## 5. Revocation semantics

| Consent | Revocable? | Effect |
| --- | --- | --- |
| Archival publication of a published contribution | No. Publication is a permanent public record (plan §2.2). Account closure does not erase it. | — |
| Qualifying-sequence use of a published, qualified exchange | No ordinary revocation; later disagreement does not silently remove an authorized unedited exchange (plan §7). | — |
| Optional `edit` (and `distribute`) grants, for future uses | Yes, prospectively, by the owner who made the grant (`POST /api/media/{id}/edit-permissions/{permissionId}/revoke`; append-only `media_permission_revocations`, never backdated; `permission-revocation.db.integration.mjs`) | rendering, approval and release of anything not yet released fail closed; an already released summary stays public with a dated notice; already distributed copies cannot be recalled and the platform does not promise that; a new grant is a new row. The private reason is shown only to the owner |
| Policy endorsement | Yes, by withdrawal event | joint status ends; history kept |
| Campaign delegate grant | Yes, one way (`revoked_at`) | grant cannot be re-activated; a new grant is a new row. Account closure revokes all of an account's memberships and delegated roles |
| Candidacy in an election | Yes, by withdrawal (final) | no new debates or contributions; published history stays attributed ([ACCOUNT_CLOSURE_AND_WITHDRAWAL.md](../docs/ACCOUNT_CLOSURE_AND_WITHDRAWAL.md)) |
| Account | Yes, by closure (final) | private drafts and reports erased; every authenticated route and attributed insert refused; published record stays |
| Delivery destination | Yes, by disabling | no further actions to it; earlier provider-confirmed states remain |
| Assistant provider / improvement consent | Yes | provider consent is per draft; improvement-consent revocation appended to `private_assessment_privacy_events`; private reports can be erased ([ASSISTANT_CONSENT_REVOCATION.md](../docs/ASSISTANT_CONSENT_REVOCATION.md)) |

## 6. Consent that can never be inferred

- A draft is never published by uploading, saving, previewing or analysing it; only the explicit confirmation with the current fingerprint publishes.
- No invitation, notification or position is sent or published for a real candidate without that candidate's confirmation (AGENTS.md). Technically, notices and invitations go only to destinations the recipient candidate registered and verified themselves; an invitation is shown as sent only with provider evidence.
- No synthetic candidate speech, invented quotation or impersonated approval. The Debate Assistant never edits content.
- Joint summaries need both candidates' approval of the exact final artifact.
