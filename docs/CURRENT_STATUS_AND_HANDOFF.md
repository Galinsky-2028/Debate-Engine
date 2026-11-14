# Public Debate Engine current development and handoff status

## Current status (2026-11-14)

**Implemented in source and merged:** everything listed in the October 15 section below, plus persisted qualifying-sequence revisions, per-branch rule versions, administrator outage extensions, scoped/partial policy agreements, revocation of optional edit permissions, exceptional restrictions with appeals, account closure and candidacy withdrawal, verified delivery destinations with an honest outbox (notifications, distribution, invitations), storage/render budgets, operations monitors, and the fixes from the AI-assisted [security review](SECURITY_REVIEW_2026-11-14.md). Rules, transitions and covering tests: [spec/state-machine.md](../spec/state-machine.md); evidence per unit: [acceptance-evidence.md](acceptance-evidence.md); next tasks: [agent-handoff.md](agent-handoff.md).

**Remaining:**

1. Operational acceptance: every gate in `registry/production-acceptance.json` and every unit's `acceptance` in `registry/prs.json` is pending.
2. Real candidate onboarding, with the candidate's confirmation before any opening, invitation or position is published.
3. No email provider and no webhook destinations are configured; notices and invitations stay queued and are shown as not sent.
4. No always-on worker on free hosting: platform administrators run pending deadline and outbox jobs from `/workspace/admin/operations`; a scheduled worker can be added later with cost approval.
5. External human security review is deferred follow-up under the AGENTS.md owner policy; the November 14 review is AI-assisted, not independent.
6. The unfinished requirement beginning "When a candidate uploads a video…" remains unresolved; no rule has been inferred.

## History

The sections below are kept as dated history.

## November 14 repository transfer

The repository was transferred to [`Galinsky-2028/Debate-Engine`](https://github.com/Galinsky-2028/Debate-Engine); GitHub redirects the old owner path. `registry/prs.json`, the CI and registry workflows, the E2EESA status files and the live-deployment smoke check now use that identity ([details](REPOSITORY_NAME_TRANSITION.md)). The web container applies pending migrations before it starts and `/api/health` reports the deployed commit ([deployment runbook](deployment-runbook.md)). The handoff documents required by section 20 of the plan are indexed in [agent-handoff.md](agent-handoff.md).

## November 9 deployment work

The owner replaced the inaccessible old Render/Neon targets; current bindings are in `docs/INFRASTRUCTURE.md` and `AGENTS.md`. Browser preparation now runs locally on Mac/Windows/Linux for free accounts; the hosted option is guarded by a server-side paid entitlement with billing intentionally deferred. An independent trusted scanner remains required for both paths. A Docker-based, outbound-only operator-laptop worker supports free web hosting; the fully hosted ClamAV runtime remains in `Dockerfile.production`. Pair the operator from `/workspace/scanner`.

The first-upload service is now live at https://public-debate-engine.onrender.com on free Render compute. [Deployment evidence and first-use steps](FIRST_UPLOAD_DEPLOYMENT.md) record the exact source, resource IDs, tests, successful live scanner round trip, and remaining owner actions. The temporary QA scanner was stopped after testing; do not presume an agent or scanner keeps running between sessions.

Release diagnostics now read canonical `registry/prs.json`, report missing operational approvals instead of crashing on the retired roadmap redirect, and follow the owner's AI-assisted review policy without claiming independent human certification. The full lifecycle acceptance entries remain pending; a first-upload deployment must not be reported as completion of all 44 work units.

The dated status below is historical and does not override current infrastructure bindings.

**Reviewed:** October 15, 2026. **Product:** Public Debate Engine. **Repository at that date:** `neophilism/Debate-Engine`, since transferred to [`Galinsky-2028/Debate-Engine`](https://github.com/Galinsky-2028/Debate-Engine) ([details](REPOSITORY_NAME_TRANSITION.md)).

## Canonical resources

- Source: https://github.com/Galinsky-2028/Debate-Engine (formerly `neophilism/Debate-Engine`)
- Neutral Render preview: https://public-debate-engine-preview.onrender.com
- Render service: srv-db5j814s728c738161ig, workspace tea-db23jkks728c73av263g
- Neon project: rapid-moon-08277391
- Development database branch: br-curly-mountain-b56lyomz
- **Production Neon branch must remain untouched** until explicit acceptance.

## What is implemented in source

Authentication, candidate verification, same-office debate initiation, permanent public original videos, reciprocal asynchronous replies, question assessments and objections, typed due-date obligations, public footnoted/qualifying sequences, source documents, captions and search, candidate directory, exact-version policy synthesis and mutual approvals, private source-editing permissions, FFmpeg summary rendering source, exact rendered-file approval/release rules, publicly downloadable evidence press packages, RSS and read-only API/embeds, internal SHA-256 storage auditing, and multiple automated CI suites.

**This is not an assertion that every listed workflow has passed production end-to-end testing.** The public web preview has passed a no-secret smoke run; real source videos and actual campaigning accounts have not been populated. The production database has not been migrated.

## Required acceptance gates and blockers

1. Approve independent candidate identity verification administration and test distinct verified candidate accounts with real sign-in/session boundaries.
2. Perform a realistic asynchronous two-participant pilot (including rejected and disputed answers) and test that ALL published responses persist.
3. Configure and deploy an appropriately isolated media worker, bounded by explicit cost authorization; Render preview is free, but a continuously running worker is not authorized under the plan alone.
4. Confirm real object-store retention, independent backups, verified restore from both database and media objects, and externally retained evidence/manifests.
5. Complete media malware scanning, resumable upload and correct publication receipt behavior for large files.
6. Review E2EESA applicability and negative security/malware/SSRF/authorization cases and manual WCAG 2.2 AA/mobile Safari.
7. Configure specific authorized media contact destinations and delivery provider; no automated external dissemination is currently connected.
8. Obtain and connect the candidate's actual original videos and policy materials before describing public debates as launched.
9. Confirm Render/Neon **production** deployment and operational health after authorization; do not copy development credentials into public production.
10. Update Engine Room and final release registry with **actual** operational evidence. No milestone can be marked accepted solely because its source PR merged.

See `registry/prs.json` for the canonical 44-unit plan and real source PR links, and `docs/DEVELOPMENT_PLAN.md` for the normative detailed plan. `registry/roadmap.json` is a retired redirect and must not be treated as a second roadmap. A different agent can continue from these files without access to any prior ChatGPT memory.
