# PostgreSQL integrity acceptance

Every PR runs all numbered migrations against a disposable PostgreSQL 18 service, re-checks their checksums, and exercises immutable published videos, questions, assessed answers, policy hashes, and the append-only record in a fictional transaction that is always rolled back. This is not yet a browser/media integration test.

## Disposable local candidate browser pilot

`node scripts/local-candidate-pilot.mjs` copies the application into a new `/tmp/pde-local-pilot-*` directory, excluding Git metadata, dependencies, build outputs and local environment files. It references the installed dependencies and injects signed fictional identities into that copy only. The real `lib/auth/server.ts` stays unchanged. Local fixture activation requires explicit opt-in, the exact temporary directory, no Git metadata, no configured Neon Auth and the fixed disposable loopback database. It does not validate actual managed sign-in.

Provide a disposable PostgreSQL 18 instance at `localhost:5432` with the documented fixture role/database `debate_ci` and the synthetic CI-only password `test_only_password`. The pilot uses existing fixture tables and unique run titles, so previous fictional publications do not produce false private-draft search failures. Never use a hosted database or real candidate records. Ports 3100 and 3443 must be free; existing listeners are left alone. The runner creates and removes its test TLS private key, stops the processes it starts, and reports its temporary log directory. It does not delete the fixture database or publish anything externally.

Install Playwright Chromium with `npx playwright install chromium`, or set `PDE_CHROMIUM_EXECUTABLE` to a locally installed Chromium binary. The same executable override is supported by public browser acceptance. In this cloud environment the tested command is:

```sh
PDE_CHROMIUM_EXECUTABLE=/usr/bin/chromium node scripts/local-candidate-pilot.mjs
```

The pilot covers separate signed candidate sessions, verification by the separate fixture reviewer role, private draft isolation, two reciprocal questions, assessment authority, published sequence preservation after a reversal, attributed corrections, two-party rule activation, old deadline preservation, rejection of a stale-rule draft and a new reply under updated rules. Production authentication never accepts these fixture sessions.
