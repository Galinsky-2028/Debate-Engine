# Agent handoff

Start here if you are a new developer or agent. Nothing below depends on memory of an earlier conversation. Working rules, infrastructure bindings and the owner's standing policies are in [AGENTS.md](../AGENTS.md). Read them first.

## Where things are

| Need | Document |
| --- | --- |
| Product requirements and the 44-unit plan | [DEVELOPMENT_PLAN.md](DEVELOPMENT_PLAN.md); canonical unit/PR registry [`registry/prs.json`](../registry/prs.json) |
| Normative rules | [spec/debate-protocol.md](../spec/debate-protocol.md), [spec/state-machine.md](../spec/state-machine.md), [spec/permission-and-consent-model.md](../spec/permission-and-consent-model.md), [spec/archive-and-restriction-policy.md](../spec/archive-and-restriction-policy.md) |
| How it is built and why | [architecture.md](architecture.md), [decisions/](decisions/README.md) |
| Run, test, deploy, recover | [local-development.md](local-development.md), [deployment-runbook.md](deployment-runbook.md), [backup-and-restore.md](backup-and-restore.md) |
| Operations and cost controls (plan §20 `operations-and-cost-controls.md`) | [OPERATIONS_AND_COST_CONTROLS.md](OPERATIONS_AND_COST_CONTROLS.md) |
| Security posture | [security-and-E2EESA-applicability.md](security-and-E2EESA-applicability.md) |
| Accessibility | [accessibility-test-plan.md](accessibility-test-plan.md) |
| What is proven and what is pending | [acceptance-evidence.md](acceptance-evidence.md), `npm run release:check` |
| Current deployment and history | [INFRASTRUCTURE.md](INFRASTRUCTURE.md), [FIRST_UPLOAD_DEPLOYMENT.md](FIRST_UPLOAD_DEPLOYMENT.md), [CURRENT_STATUS_AND_HANDOFF.md](CURRENT_STATUS_AND_HANDOFF.md) |
| Repository identity | [REPOSITORY_NAME_TRANSITION.md](REPOSITORY_NAME_TRANSITION.md) (`Galinsky-2028/Debate-Engine`, formerly `neophilism/Debate-Engine`) |

## Current state (2026-11-14)

- Source: Next.js 16.4.6, React 19.2.0, Node.js 22, `pg` 8, migrations `0001`–`0020` (23 files) plus any added by work merged after this date.
- Live: https://public-debate-engine.onrender.com (free Render web service, manual deploys from `main`, self-migrating container; `/api/health` reports the deployed commit). Neon project `cool-dawn-42333373`.
- Uploads need the operator-laptop scanner running; no background worker or scheduler runs between sessions.
- No real candidate debate, position, invitation or agreement has been published by the platform. Fixtures are fictional and test-only.
- All 44 units and all seven production gates are acceptance-pending.

## In-flight work (parallel branches at the time of writing)

Each adds its own document; until it merges, the linked file may not exist.

| Area | Document |
| --- | --- |
| Exceptional restrictions and appeals | [RESTRICTIONS_AND_APPEALS.md](RESTRICTIONS_AND_APPEALS.md) |
| Account closure and election withdrawal | [ACCOUNT_CLOSURE_AND_WITHDRAWAL.md](ACCOUNT_CLOSURE_AND_WITHDRAWAL.md) |
| Persisted sequence manifests, branch rule versions, outage adjustments | [BRANCH_RULE_VERSIONS.md](BRANCH_RULE_VERSIONS.md) |
| Partial agreements and optional-permission revocation | added with that work (PDE-19/20) |
| Dissemination outbox and notifications | [DISSEMINATION_AND_NOTIFICATIONS.md](DISSEMINATION_AND_NOTIFICATIONS.md) |
| Invitations | [INVITATIONS.md](INVITATIONS.md) |
| Budgets and cost controls | [OPERATIONS_AND_COST_CONTROLS.md](OPERATIONS_AND_COST_CONTROLS.md) |

After they merge, update the **planned** rows in [spec/state-machine.md](../spec/state-machine.md) and the pending column of [acceptance-evidence.md](acceptance-evidence.md).

## Next unblocked tasks

1. Reconcile the parallel branches above, run all checks, and update the spec rows they complete.
2. Press kit agreement source: `lib/server/press-kit.ts` selects the latest version both candidates *ever* accepted (`policy_acceptances`) rather than one both *currently* endorse (`policy_endorsement_events`), so a withdrawn agreement can still appear in a press kit. Align it with `releaseSummary`, which already uses current endorsement, and add a test.
3. Add axe checks for a populated debate page, embed and workspace pages ([accessibility-test-plan.md](accessibility-test-plan.md)).
4. Complete and review `security/e2eesa-inventory.json`, then record a dated AI-assisted `securityReview` entry with evidence. Do not claim external review.
5. Decide (owner) whether private drafts stay server-side or move to local/E2EE storage ([security-and-E2EESA-applicability.md](security-and-E2EESA-applicability.md)).

## Blocked on the owner

- Real launch materials: original videos, questions, rules and the candidate's confirmation before anything is published or any invitation is sent.
- Cost approval for any paid worker, storage or notification provider; billing activation (deferred).
- Optional repository slug rename to `Public-Debate-Engine` (not decided).
- The unfinished requirement "When a candidate uploads a video, whether the original video or" remains unresolved. Do not infer a rule.

## Checks before every commit

`npm run typecheck`, `npm test`, `npm run db:migrate && npm run test:db` (disposable database), `npm run build`, `GITHUB_REPOSITORY=Galinsky-2028/Debate-Engine node scripts/validate-pr-registry.mjs`, `python3 scripts/validate_e2eesa_status.py`.
