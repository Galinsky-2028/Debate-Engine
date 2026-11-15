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

- Source: Next.js 16.4.6, React 19.2.0, Node.js 22, `pg` 8, 37 migration files from `0001` to `0035` (there is no `0030`; `0003`, `0010` and `0013` each have two files).
- Live: https://public-debate-engine.onrender.com (free Render web service, manual deploys from `main`, self-migrating container; `/api/health` reports the deployed commit). Neon project `cool-dawn-42333373`.
- Uploads and supporting documents need the operator-laptop scanner running.
- No real candidate debate, position, invitation or agreement has been published by the platform. Fixtures are fictional and test-only.
- All 44 units and all seven production gates are acceptance-pending.

**Implemented in source (merged 2026-11-14):** exceptional restrictions and appeals, account closure and candidacy withdrawal ([RESTRICTIONS_AND_APPEALS.md](RESTRICTIONS_AND_APPEALS.md), [ACCOUNT_CLOSURE_AND_WITHDRAWAL.md](ACCOUNT_CLOSURE_AND_WITHDRAWAL.md)); persisted qualifying-sequence manifests, branch rule versions and administrator outage extensions ([QUALIFYING_SEQUENCE_UI.md](QUALIFYING_SEQUENCE_UI.md), [BRANCH_RULE_VERSIONS.md](BRANCH_RULE_VERSIONS.md), [DEADLINES_AND_NOTIFICATIONS.md](DEADLINES_AND_NOTIFICATIONS.md)); scoped/partial policy agreements and revocation of optional edit permissions ([POLICY_CONVERGENCE.md](POLICY_CONVERGENCE.md), [DERIVATIVE_RIGHTS.md](DERIVATIVE_RIGHTS.md)); verified delivery destinations, an honest outbox, notifications, distribution and invitations ([DISSEMINATION_AND_NOTIFICATIONS.md](DISSEMINATION_AND_NOTIFICATIONS.md), [INVITATIONS.md](INVITATIONS.md)); storage/render budgets and operations monitors ([OPERATIONS_AND_COST_CONTROLS.md](OPERATIONS_AND_COST_CONTROLS.md)); and the fixes from the AI-assisted [security review](SECURITY_REVIEW_2026-11-14.md). The [spec/](../spec/state-machine.md) files and [acceptance-evidence.md](acceptance-evidence.md) describe this code.

**What remains:**

- Operational acceptance: every gate in `registry/production-acceptance.json` is pending; `npm run release:check` exits 2.
- Real candidate onboarding: verification standard, real accounts and the candidate's confirmation before any opening, invitation or position.
- No email provider (`EMAIL_API_URL`/`EMAIL_API_KEY`/`EMAIL_FROM`) and no webhook destinations are configured, so notices and invitations stay "Queued — not sent".
- Nothing runs on a schedule (owner decision 2026-11-14). Deliveries run right after the action that queued them; deadline jobs and anything left pending run when a platform administrator presses Run pending jobs now on `/workspace/admin/operations` or starts the manual GitHub workflow (see `docs/OPERATIONS_AND_COST_CONTROLS.md`).
- External human security review is deferred follow-up under the AGENTS.md policy; it is not a release blocker and must not be claimed.
- Not implemented: playback encodes. (Account suspension and reinstatement by platform administrators ([ACCOUNT_CLOSURE_AND_WITHDRAWAL.md](ACCOUNT_CLOSURE_AND_WITHDRAWAL.md)), obligations superseded by a recorded agreement, `distribute` grants and durable invitation response clocks are implemented: [DEADLINES_AND_NOTIFICATIONS.md](DEADLINES_AND_NOTIFICATIONS.md), [DERIVATIVE_RIGHTS.md](DERIVATIVE_RIGHTS.md), [INVITATIONS.md](INVITATIONS.md).)
- The unfinished requirement "When a candidate uploads a video…" (below).

## Next unblocked tasks

1. Add axe checks for a populated debate page, embed and workspace pages ([accessibility-test-plan.md](accessibility-test-plan.md)).
2. Complete and review `security/e2eesa-inventory.json`, then record a dated AI-assisted `securityReview` entry with evidence. Do not claim external review.
3. Decide (owner) whether private drafts stay server-side or move to local/E2EE storage ([security-and-E2EESA-applicability.md](security-and-E2EESA-applicability.md)).

## Blocked on the owner

- Real launch materials: original videos, questions, rules and the candidate's confirmation before anything is published or any invitation is sent.
- Cost approval for any paid worker, storage or notification provider; billing activation (deferred).
- Optional repository slug rename to `Public-Debate-Engine` (not decided).
- The unfinished requirement "When a candidate uploads a video, whether the original video or" remains unresolved. Do not infer a rule.

## Checks before every commit

`npm run typecheck`, `npm test`, `npm run db:migrate && npm run test:db` (disposable database), `npm run build`, `GITHUB_REPOSITORY=Galinsky-2028/Debate-Engine node scripts/validate-pr-registry.mjs`, `python3 scripts/validate_e2eesa_status.py`.
