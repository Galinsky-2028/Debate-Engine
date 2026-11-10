# Public Debate Engine

**Better questions. Real answers. Better policy.**

A reusable, candidate-neutral platform for asynchronous, policy-centered debates. Candidates submit intact videos, address specific questions, and have their reciprocal obligations made visible. All published candidate responses remain discoverable even when excluded from the *qualifying debate sequence*.

## Authoritative development materials

- [Full 44-unit development plan](docs/DEVELOPMENT_PLAN.md)
- [Normative debate protocol](docs/DEBATE_PROTOCOL.md)
- [Infrastructure and operations](docs/INFRASTRUCTURE.md)
- [Canonical 44-unit PR registry](registry/prs.json)
- [Agent handoff](AGENTS.md)

## Development status

**First-upload deployment is live:** https://public-debate-engine.onrender.com. Sign in, register and verify your candidacy, and connect the platform operator's laptop scanner before uploading. Free accounts prepare originals locally in a browser; paid hosted preparation is staged with billing inactive. The current original-file limit is 60 MiB. See [setup and verification evidence](docs/FIRST_UPLOAD_DEPLOYMENT.md).

Full debate-lifecycle operational acceptance remains pending. No candidate positions, invitations, endorsements or policy agreements were fabricated to populate the deployment. Passing CI is separate from operational acceptance.

## Local development

Requires Node.js 22+, npm, and a local environment that can install dependencies.

```bash
npm install
npm run dev
npm run typecheck
npm test
npm run build
```

Copy `.env.example` to `.env.local` when Neon has been intentionally configured. Never commit secrets. Read-only public pages must never fabricate data when no debates have been published.

## Core publication distinction

1. **Permanent public record:** all published candidate contributions, even disputed or footnoted responses.
2. **Qualifying debate sequence:** only reciprocal exchanges meeting the review protocol.
3. **Resolution media:** derivative videos requiring exact-asset permissions and, for joint products, both participants' approvals.

See `docs/DEBATE_PROTOCOL.md` before implementing any write API.
## End-to-End Everywhere progress

The canonical [security/e2eesa-status.json](security/e2eesa-status.json) records standard implementation, complete testing and independent expert review separately. Engine Room reads it automatically from GitHub. All initial stages are pending; existing profile locks and approved decisions remain authoritative. Read [adoption and independent-account instructions](docs/E2EESA_ADOPTION.md), and run `python3 scripts/validate_e2eesa_status.py`. Record validation does not establish product security or certification.
