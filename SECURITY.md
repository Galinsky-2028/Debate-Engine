# Security policy

## Reporting a vulnerability

Please report suspected vulnerabilities privately through GitHub: **Security → Report a vulnerability** on [Galinsky-2028/Debate-Engine](https://github.com/Galinsky-2028/Debate-Engine/security/advisories/new). Do not open a public issue, and do not test against real candidates' accounts or published records. If private reporting is not available, open an issue that says only that you have a security report and asks for a private contact, without details.

Include the affected route or file, steps to reproduce, the impact you observed, and the commit or deployment you tested (`/api/health` reports the deployed commit).

## What happens next

| Step | Target |
| --- | --- |
| Acknowledge the report | 3 business days |
| Confirm or refute, and assign a severity | 7 days |
| Fix critical or high severity | 14 days, then deploy |
| Fix medium or low severity | the next scheduled release |

Every confirmed vulnerability gets the following:

- **A regression test** that fails before the fix.
- **A root-cause note** recorded in the dated security review under `docs/SECURITY_REVIEW_*.md`. The note covers which control failed and whether the same pattern exists elsewhere in the codebase.
- **Sibling search:** the codebase is searched for the same pattern, and every instance is fixed.
- **A status update** to `security/e2eesa-status.json`, when the fix affects a recorded control.

## Scope

The scope covers the web application, its API routes, the database migrations and triggers, and the operator-laptop worker (malware scanning and playback encodes). The Docker images and GitHub workflows in this repository are also in scope.

Third-party services are out of scope: Neon, Render, Neon Auth, and any future email or AI provider. Report issues in those services to the provider.

## Supported versions

Only the current `main` branch and the deployment built from it are supported.

## Status of reviews

All reviews to date are owner-authorized AI-assisted reviews ([ADR 0008](docs/decisions/0008-ai-assisted-security-review.md)). No independent human audit or certification has been performed or is claimed.
