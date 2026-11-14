# Local development

## Requirements

Node.js 22+, npm, PostgreSQL 16+ (local or Docker) for integration tests. Optional: FFmpeg (media and render tests), Docker (ClamAV, S3 rehearsal, scanner), Playwright Chromium (browser tests). No paid service is needed.

## First run

```bash
npm install
npm run typecheck
npm test            # pure domain, registry and release-gate tests
npm run build
```

`npm test` needs no database. The app starts with `npm run dev`; without `DATABASE_URL` public pages show honest empty or unavailable states, and without `NEON_AUTH_BASE_URL` plus a 32+ character `NEON_AUTH_COOKIE_SECRET` sign-in is disabled (every write returns 401).

## Database

Use a disposable database, never the production branch:

```bash
createdb -h 127.0.0.1 pde_local            # or a Neon development branch
export DATABASE_URL=postgresql://user@127.0.0.1:5432/pde_local
npm run db:migrate                         # applies packages/database/migrations in order
npm run db:check                           # verifies checksums, applies nothing
npm run test:db                            # transactional integration suites (fictional data)
```

Integration fixtures are explicitly fictional and use unique ids or rolled-back transactions. Never point `test:db` at a branch holding real candidates.

## Environment

Copy `.env.example` to `.env.local` and fill only what you need. Placeholders only; never commit values. Variables: [INFRASTRUCTURE.md](INFRASTRUCTURE.md), [AUTH_AND_VERIFICATION.md](AUTH_AND_VERIFICATION.md), [LAPTOP_PROCESSING.md](LAPTOP_PROCESSING.md). In development, plain-HTTP same-origin mutations are allowed only when `NODE_ENV` is not `production` (`request-origin.test.ts`).

## Other suites

| Command | Needs | What it proves |
| --- | --- | --- |
| `node --test tests/media.integration.mjs` | FFmpeg | rendering and clip rules on real media |
| `npm run test:clamav:live` | ClamAV daemon (`scripts/start-ci-clamd.sh`) | real clean/detected/outage verdicts |
| `npm run test:browser` | built app on `PDE_BROWSER_URL`, Chromium | public UI, keyboard, mobile, axe WCAG rules |
| `node scripts/browser-two-candidate-pilot.mjs` | CI-only auth fixture | two signed-in candidates complete a reciprocal debate |
| `npm run test:db:restore-rehearsal` | `PDE_TEST_POSTGRES_CONTAINER` | pg_dump/pg_restore round trip |
| `npm run test:s3:restore-rehearsal` | Docker, `PDE_S3_RECOVERY_FIXTURES=true` | object loss and restore |
| `npm run release:check` | none | lists unaccepted production gates (exit 2 until accepted) |
| `GITHUB_REPOSITORY=Galinsky-2028/Debate-Engine node scripts/validate-pr-registry.mjs` | none | registry contract |
| `python3 scripts/validate_e2eesa_status.py` | Python 3 | E2EESA status record integrity |

CI runs the same commands in `.github/workflows/ci.yml` (jobs `validation`, `postgres-integration`, `real-media`, `chromium-public`, `clamav-live`, `s3-recovery`, `candidate-pilot`), plus CodeQL and `npm audit` in `security-source.yml`.

## Conventions

See [AGENTS.md](../AGENTS.md) and [architecture.md](architecture.md): server logic in `lib/server` with SQL actor proofs, pure rules in `packages/domain`, additive migrations only, append-only evidence tables, fictional fixtures only.
