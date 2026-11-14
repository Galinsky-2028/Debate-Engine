# PR evidence in the canonical registry

`registry/prs.json` is the only active machine-readable plan: 44 approved work units, their explicit PR mappings, and a dated copy of GitHub's pull request list. `registry/roadmap.json` is a retirement notice and holds no milestones. The contract both consumers (Engine Room, Boardroom) apply is `registry/pr-contract.mjs`, described in [`registry/PR_FORMAT.md`](../registry/PR_FORMAT.md).

## What the sync does

`scripts/sync-pr-registry.mjs` (`npm run registry:sync`, needs `GITHUB_TOKEN` and `GITHUB_REPOSITORY`) reads `registry/prs.json`, lists every pull request through the GitHub REST API, and may change exactly three things:

1. `pullRequests` — replaced with the current GitHub observation (state, draft, timestamps, head and merge SHAs).
2. A unit's `prs` — a **merged** PR is appended only when its title starts with that unit's exact stable ID (`PDE-17: …`, or `PDE-12/13: …` for both), using `titleWorkUnitIds` from the shared contract. A PR that a person already mapped to any unit is never re-mapped by its title. Mentions elsewhere in a title, ordinals, unknown IDs and closed-unmerged PRs map nothing.
3. A unit's `openPullRequests` — the open PRs that are mapped to the unit or carry its exact leading ID. An open follow-up shows that work is still in flight; it disappears from the list when it closes.

Everything else is preserved verbatim: `state`, `implementation`, `acceptance`, `acceptanceNote`, dependencies, the plan denominator, `production_ready` and `operationalAcceptance`. The script throws if a protected unit field would change. `observedAt` moves only when the observation or a mapping actually changed. The result must pass `parsePrRegistry` before it is written, and a GitHub listing that omits an already recorded PR is treated as partial data and refused.

A merged PR is source evidence only. It can never set a unit to `accepted`, and it does not touch `registry/production-acceptance.json`; operational gates are evaluated separately by `npm run release:check` (see [production release acceptance](PRODUCTION_RELEASE_ACCEPTANCE.md)).

## Where it runs

`.github/workflows/pr-registry.yml` runs the sync after a PR closes, every six hours, and on manual dispatch, only in `Galinsky-2028/Debate-Engine`. It validates the result and commits `registry/prs.json` alone. The `validation` job in `.github/workflows/ci.yml` runs the same validator, pinned to `Galinsky-2028/Debate-Engine`, on every push to `main` and every pull request.

The former second step (`scripts/sync-roadmap-evidence.mjs`, `npm run roadmap:sync`) wrote implementation states into a milestone array in `registry/roadmap.json`. That array was retired, so the script and its test were removed. Changes to `state`, `implementation` or `acceptance` are now deliberate edits to `registry/prs.json`, reviewed like any other change.

Tests: `tests/pr-registry.test.mjs`, `registry/pr-contract.test.mjs`.
