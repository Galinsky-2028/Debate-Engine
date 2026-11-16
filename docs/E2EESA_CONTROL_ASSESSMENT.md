# E2EESA secure-development control assessment — November 16, 2026

**Nature:** owner-authorized AI-assisted assessment against the [reviewed inventory](../security/e2eesa-inventory.json). It is not an independent review and claims no certification.

Of the 19 controls, 14 are implemented and 5 are partial. Implementation stays *incomplete* in `security/e2eesa-status.json` until the partial controls are closed or the owner accepts them.

## Findings fixed in this assessment

1. **The dependency audit did not audit what ships.** The audit job ran `npm install --package-lock-only` and so audited a freshly resolved tree. It now runs `npm ci --ignore-scripts` and audits exactly the committed lockfile, and fails if `package.json` and the lock disagree.
2. **Builds were not lockfile-exact.** CI jobs and `Dockerfile.worker` used `npm install`. They now use `npm ci`.
3. **No vulnerability intake.** Added `SECURITY.md`. It covers private reporting, response targets, scope, and the remediation and root-cause rules.
4. **No dependency update automation.** Added `.github/dependabot.yml`, with weekly proposals for npm, GitHub Actions and the Docker base images.

## Controls

| Control | Requirement | State | Assessment | Evidence |
| --- | --- | --- | --- | --- |
| SD-REQUIREMENTS | Security requirements are defined | implemented | Authorization, consent, immutability, privacy and restriction rules are normative in spec/ and the plan. | `docs/DEVELOPMENT_PLAN.md`, `spec/permission-and-consent-model.md`, `spec/archive-and-restriction-policy.md`, `docs/security-and-E2EESA-applicability.md` |
| SD-OWNERS | Security roles and owners are named | partial | The owner policy and the AI-assisted review role are recorded and SECURITY.md defines intake. No named human security owner or CODEOWNERS file exists; naming one is an owner decision. | `AGENTS.md`, `SECURITY.md`, `docs/decisions/0008-ai-assisted-security-review.md` |
| SD-TOOLS | Security tooling is defined and used | implemented | CodeQL security-extended, npm audit (high), adversarial unit/DB tests, live ClamAV and browser axe runs in CI. | `.github/workflows/security-source.yml`, `.github/workflows/ci.yml`, `docs/SECURITY_STATIC_ANALYSIS.md` |
| SD-RELEASE-GATES | Releases are gated on security criteria | implemented | Seven operational gates; release:check exits non-zero until all are accepted with dated evidence. | `packages/domain/release-gates.mjs`, `registry/production-acceptance.json`, `tests/release-gates.test.mjs` |
| SD-ENVIRONMENT | Build and deployment environments are separated and protected | implemented | Production and development Neon branches are separate; CI uses disposable databases only; production secrets live only in Render. | `docs/INFRASTRUCTURE.md`, `docs/deployment-runbook.md`, `AGENTS.md` |
| SD-SOURCE-ACCESS | Source access is controlled | partial | Workflows run least-privilege (contents: read except the registry sync). Branch protection on main is not configured; enabling it is a repository-settings decision for the owner. | `docs/REPOSITORY_NAME_TRANSITION.md`, `.github/workflows/pr-registry.yml` |
| SD-RELEASE-AUTH | Releases are authorized and traceable | implemented | Render auto-deploy is off; deploys are explicit from main and /api/health reports the exact deployed commit. | `docs/deployment-runbook.md`, `app/api/health/route.ts` |
| SD-ARCHIVE | Released artifacts and evidence are retained | implemented | Originals are digest-bound and re-hashed by the archive audit; evidence tables are append-only. | `scripts/audit-archive.mjs`, `docs/ARCHIVE_AUDIT.md`, `docs/backup-and-restore.md` |
| SD-DESIGN | Security is designed in | implemented | SQL-proven actors, append-only triggers, digest-bound media, outbound SSRF controls, reviewed component/data-flow inventory. | `docs/architecture.md`, `docs/decisions/0002-raw-sql-append-only-triggers.md`, `docs/decisions/0005-operator-laptop-scanner.md`, `security/e2eesa-inventory.json` |
| SD-DESIGN-REVIEW | Designs are reviewed for security | partial | AI-assisted design reviews are recorded; independent human design review remains pending follow-up (not a blocker under AGENTS.md). | `docs/SECURITY_REVIEW_2026-11-14.md`, `docs/SECURITY_REVIEW_2026-11-15.md`, `security/e2eesa-inventory.json` |
| SD-DEPENDENCIES | Third-party components are managed | implemented | Fixed in this assessment: the audit now runs on exactly the committed lockfile (npm ci) instead of re-resolving it; CI and the render worker install with npm ci; Dependabot proposes npm, Actions and base-image updates weekly. | `package-lock.json`, `.github/dependabot.yml`, `.github/workflows/security-source.yml` |
| SD-SECURE-CODE | Code follows secure coding practices | implemented | Parameterized SQL, same-origin checks, bounded bodies, sanitized headers, constant-time token comparison. | `lib/server/http.ts`, `packages/domain/request-origin.ts`, `packages/domain/outbox.ts`, `tests/hardening.test.ts` |
| SD-BUILD-CONFIG | Builds are reproducible and hardened | partial | Fixed in this assessment: lockfile-exact installs everywhere. Containers run as the unprivileged node user. Remaining: base images and Actions are pinned by version tag, not digest; Dependabot keeps them current. | `Dockerfile`, `Dockerfile.worker`, `Dockerfile.scanner`, `.github/workflows/ci.yml`, `next.config.ts` |
| SD-CODE-REVIEW | Changes are reviewed before release | partial | Every change goes through a pull request with the full CI and AI-assisted review; required human review is not configured (owner policy allows merging without it). | `.github/workflows/ci.yml`, `AGENTS.md` |
| SD-TESTING | Security testing is performed | implemented | Adversarial authorization, immutability, SSRF, malware and privacy cases on real PostgreSQL and Chromium in CI. | `tests/hardening.test.ts`, `tests/restrictions.db.integration.mjs`, `tests/suspension.db.integration.mjs`, `tests/playback-encode.test.ts`, `scripts/browser-two-candidate-pilot.mjs` |
| SD-DEFAULTS | Secure defaults | implemented | CSP and frame denial by default; fail-closed public origin in production; loopback webhooks only outside production; uploads blocked without a scanner. | `next.config.ts`, `lib/server/public-origin.ts`, `packages/domain/outbox.ts` |
| SD-INTAKE | Vulnerability reports can be received | implemented | Fixed in this assessment: SECURITY.md defines private reporting, response targets and scope. Enabling GitHub private vulnerability reporting is a repository setting for the owner. | `SECURITY.md` |
| SD-REMEDIATION | Vulnerabilities are remediated | implemented | Findings are fixed with tests in the review PRs; SECURITY.md sets response targets. | `SECURITY.md`, `docs/SECURITY_REVIEW_2026-11-14.md`, `docs/SECURITY_REVIEW_2026-11-15.md` |
| SD-ROOT-CAUSE | Root causes are analysed | implemented | SECURITY.md requires a root-cause note and sibling search for every confirmed vulnerability. | `SECURITY.md`, `docs/SECURITY_REVIEW_2026-11-15.md` |

## Open items

These are owner decisions or deferred work:

- **Branch protection.** Enable it on `main`, with required status checks (SD-SOURCE-ACCESS, SD-CODE-REVIEW).
- **Private vulnerability reporting.** Enable GitHub's private vulnerability reporting (SD-INTAKE).
- **Security owner.** Name a human security owner and, optionally, add a `CODEOWNERS` file (SD-OWNERS).
- **Digest pinning.** Pin base images and Actions by digest, or accept tag pinning plus Dependabot (SD-BUILD-CONFIG).
- **Independent review.** Independent design and expert review remains deferred follow-up under AGENTS.md (SD-DESIGN-REVIEW).
