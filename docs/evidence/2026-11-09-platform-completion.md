# November 9, 2026 development verification

Base commit: `4ef3da6` (PDE-32, PR 87). Working branch: `finish-debate-platform`. These results describe local, unmerged source changes. They do not establish a deployed release or completion of every one of the 44 planned units.

## Implemented and checked

- Append-only qualifying sequence manifests, historical versions and database-computed digests. Later assessments remain public without deleting previously published exchanges; new reciprocal exchanges can extend that history.
- Deterministic assessment event ordering, including decisions with equal timestamps, legacy rows and PostgreSQL Date values.
- Up to three reciprocal questions in the candidate composer, including multiple answer mappings through private review and publication.
- Public branch-rule proposals, separate exact-digest approvals by both candidates, immutable activation history and future-only rule versions. New publications bind their accepted version; stale drafts fail rather than silently accepting different rules. Existing deadlines and contributions remain unchanged.
- Safe local signed-session pilot in a disposable copy. Production authentication source remains unchanged. Test keys are ephemeral, and the fixture database and media are explicitly fictional.
- Canonical registry/release tooling uses `registry/prs.json`, preserves operational gate states, and supports the observed organization transfer without inventing fresh GitHub merge observations.
- Populated-page mobile layout and text contrast corrections verified by real Chromium and automated accessibility checks.

## Validation

| Check | Observed result |
| --- | --- |
| `npm run typecheck` | Passed |
| `npm test` | 97 passed; 0 failed; 0 skipped |
| Explicit numbered migrations and `npm run db:check` against disposable PostgreSQL 18 | Passed, including migrations 0019–0021 |
| `npm run test:db` | 9 integration tests passed; 0 failed; 0 skipped. The multi-candidate pilot includes adverse manifest and rule-change SQL operations. |
| `npm run build` using normal production authentication source | Passed |
| `node --test tests/media.integration.mjs` | 2 passed using actual FFmpeg and synthetic media |
| Two signed-candidate Chromium pilot | Passed: four published contributions, two reciprocal questions, separate reviewer, privacy/impersonation rejection, preserved sequence after reassessment, concurrent/repeated rule approval, old deadlines retained, stale draft rejected, new reply using rule version 2 |
| Populated debate page at 1250px and 375px | No horizontal overflow; automated WCAG A/AA checks passed |
| PostgreSQL dump/restore rehearsal | Passed across 42 tables, with full row fingerprints, original publication guards and immutable sequence manifests preserved |
| Canonical PR registry validation | Passed for `Galinsky-2028/Debate-Engine`, 44 approved units |
| Reconciliation repeatability | Second run makes no changes; it does not recreate the retired roadmap or approve operational gates |
| `npm run release:check` | Expected exit 2 with `ready: false` and concrete pending gates; no retired-roadmap parser failure |

The full test outputs are retained in `/workspace/debate-validation`. The reproducible local candidate pilot is documented in `docs/INTEGRATION_TESTING.md`. Its final run reported `populatedDebateMobileLayout: true`, `populatedDebateAutomatedAccessibility: true`, `mutuallyApprovedRuleChange: true`, `oldDeadlinesPreserved: true` and `staleRuleDraftRejected: true`.

## Remaining limits

Actual Neon Auth sign-in, an authorized hosted scanner with current official signatures, persistent media storage, isolated worker operation, independent offsite media recovery, external delivery and production deployment were not activated or accepted here. Local synthetic sessions are not managed-auth acceptance. Manual assistive-technology/Safari review and live provider checks remain separate.

The plan's unfinished requirement beginning “When a candidate uploads a video, whether the original video or …” remains unresolved and was raised with the owner. No completion was invented.

GitHub REST and GraphQL reads were denied by the environment, so no new PR, merge, current-head CI acceptance or deployment is claimed. The old PR 87 URL was observed redirecting to the same PR under `Galinsky-2028`; historical IDs, numbers, states and timestamps were preserved while normalizing canonical links. No environment draft was reapplied or published.

## Deployment follow-up

The owner subsequently explicitly requested deployment and supplied Render/Neon keys. The running environment confirms both key bindings ready; authenticated API requests are still blocked by proxy HTTP 403. The draft binding also remains unreadable, and no publish control is exposed. See `docs/DEPLOYMENT_ACCESS.md` for the exact existing targets and required network additions.

Deployment preparation also fixed runtime readiness: the exact release migration fingerprints, required tables, authentication signing key and storage credentials are now checked. The updated type check, 102-test unit suite and production build passed. CI was enabled for pushed development branches using the existing standard GitHub-hosted jobs. No hosted migration or deployment has been claimed.
