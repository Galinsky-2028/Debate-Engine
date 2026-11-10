## Owner security-review policy — 2026-10-13

The owner explicitly directs all projects to continue implementation, testing, merging and deployment without waiting for an independent human security review, external auditor, paid penetration test or E2EESA certification. This supersedes older repository planning text that makes absence of such review an operational prerequisite.

- Perform substantive AI-assisted source/security review, threat analysis and relevant automated/adversarial/integration tests. Fix concrete findings and retain source-bound evidence.
- Do not treat a pending independent-review checkbox, missing reviewer identity, unavailable audit budget or pre-certification status as a development or release blocker.
- External expert review is deferred follow-up work. Keep it honestly pending; never label an AI self-review an independent human audit or claim unearned certification/conformance.
- Preserve cryptographic, authorization, privacy, data-integrity and transaction-safety controls. Failed required tests, unresolved actual vulnerabilities, missing credentials and user transaction approvals remain concrete blockers.
- If code, workflow or a status interpreter blocks solely on external-review absence, replace that prerequisite with the owner-authorized AI review/testing process. Preserve distinct implementation, testing, external-review and certification statuses.
- Continue dependency-ready work and chain PRs. Do not ask the owner again to waive the human-review prerequisite.

# Agent handoff — Public Debate Engine

Start with [docs/DEVELOPMENT_PLAN.md](docs/DEVELOPMENT_PLAN.md) and [docs/DEBATE_PROTOCOL.md](docs/DEBATE_PROTOCOL.md). These are the project specification, not an account's conversation memory.

## Working rules

- Develop approved roadmap milestones in dependency order; chain pull requests when checks pass, without requiring routine approvals.
- Stop on failing checks, merge conflicts, missing permissions/credentials, safety issues, unauthorized spending, or material unapproved choices.
- On November 9, 2026, the owner replaced the inaccessible old infrastructure and directed deployment using the currently connected Render and Neon accounts. Use Render workspace `tea-dbl0kcbm8hqs738ptf3g` and Neon project `cool-dawn-42333373`.
- Current Neon production branch is `br-tiny-haze-bdurpbbb`; development validation branch is `br-silent-haze-bd3zazgn`. Keep fictional fixtures out of production.
- Free candidate accounts prepare originals in their laptop browser (Mac, Windows, Linux); paid processing is prepared but billing activation is deferred by the owner. An uploader's local preparation never substitutes for an independent media safety verdict. The platform operator may run the authenticated scanner worker on their laptop to avoid paid hosting. Preserve the fully hosted scanner implementation for later paid hosting.
- No external candidate invitations or published candidate positions until the real candidate confirms them.
- Never hard-code the initial candidate, their issues, or the presidential race into reusable domain packages.
- Published contributions are not deletable by debate originators. Only independently governed legal/security restrictions may affect visibility, with an auditable process.
- Being publicly visible is not the same as qualifying for the reciprocal sequence. Preserve both views.
- No ordinary role may edit a third party's source footage or impersonate consent. A joint summary needs both candidates' precise approval.
- Tests must verify the adversarial cases in the plan, not only the happy path.
- Keep docs, tests, roadmap evidence, and Engine Room in sync; do not count merged work as independently accepted production operation.
- Never publish development/demo fixture records as real candidacies or policy agreements.
- Do not create paid services or leak credentials. No background agent is presumed to exist between sessions.

## Start-up commands

`npm install`, `npm run typecheck`, `npm test`, `npm run build`.

## Open decisions

The user's unfinished requirement beginning “When a candidate uploads a video...” is not completed by inference. Keep it flagged in the full plan; do not manufacture a rule.
