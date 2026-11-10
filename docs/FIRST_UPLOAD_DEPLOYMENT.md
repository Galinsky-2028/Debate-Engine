# First-upload deployment: November 9, 2026

## Live release

- URL: https://public-debate-engine.onrender.com
- Source: [PR #90](https://github.com/Galinsky-2028/Debate-Engine/pull/90), merged commit `a82af3ca03960ffcc8119cb8cb08f6d32476a468`.
- All ten PR checks passed on source head `02c2c9c2420566ae7de1ae2515bfdf87ecb23c8b`, including CodeQL acceptance, runtime dependency audit, unit/build validation, PostgreSQL integration, real media, real ClamAV, storage recovery, public Chromium, and the two-candidate signed-session browser pilot.
- Render service `srv-dbp9png8v5cc73dkk830`, workspace `tea-dbl0kcbm8hqs738ptf3g`, free plan, Ohio, `main`, automatic deploys disabled.
- Deploy `dep-dbp9po08v5cc73dkk8u0` reached `live` at 2026-11-10 04:27:57 UTC (November 9, 11:27 p.m. Eastern).
- Neon project `cool-dawn-42333373`, production branch `br-tiny-haze-bdurpbbb`, isolated validation branch `br-silent-haze-bd3zazgn`. All 23 versioned migrations are applied. The initial 2028 presidential election is configured as database content, not hard-coded reusable logic.
- The owner's selected `galinsky2028@gmail.com` Auth user was provisioned and bound by immutable ID to administrator access. Google sign-in is enabled and the exact live origin is trusted. Candidate positions and public contributions were not invented or published.

## Verification

Local checks: 96 unit tests, 10 PostgreSQL integration tests, type checking, production build, desktop/mobile Chromium and automated WCAG rules. The free web image starts under the unprivileged Node user; both scanner source files are readable by its unprivileged worker. Official ClamAV signatures accepted clean test bytes and rejected the standard harmless EICAR test string.

Private Neon storage accepted writes and signed reads and rejected anonymous reads. The complete local Next.js/PostgreSQL/private-storage/native-ClamAV protocol test rejected wrong credentials, wrong hashes, wrong leases and replayed results; expired heartbeat blocked new uploads.

Live HTTP verification confirmed health, required schema, connected database, configured storage, archive, sign-in, upload composer, and the Google authentication redirect. Anonymous session reads returned null. Scanner pairing download without sign-in returned 401; unpaired worker polling returned 401. A temporary paired worker loaded official signatures, claimed private operational fixture job `55e48cb7-85aa-4bc0-816e-35ed89de1f80`, verified its bytes and hash, and recorded a clean verdict at 2026-11-10 04:30:38 UTC. The private fixture object was removed after the test. It was never a public candidate submission or media asset.

The live browser attempt was blocked by this cloud execution environment's Chromium proxy-CA trust configuration (`ERR_CERT_AUTHORITY_INVALID`), while HTTPS requests using the configured CA trust succeeded. Source-identical browser acceptance and the two-candidate pilot passed in CI. This does not establish a real owner's successful Google session or an actual candidate publication; those require the owner's interaction and original video.

## First use tonight

1. Open the live site and choose **Continue with Google**, using `galinsky2028@gmail.com`.
2. In the workspace, register your actual candidacy for the configured election and complete the administrator verification workflow with an accurate procedural reason.
3. Open `/workspace/scanner`, install/start Docker, download the source ZIP and private `scanner.env` into the same extracted folder, and run `docker compose -f compose.scanner.yaml up --build`. This works on Mac, Windows and Linux. Allow 2 GB RAM and time for the initial official-signature download.
4. Wait for **Scanner connected**, then prepare an original video of at most 60 MiB. Add your actual proposal and questions, select reciprocal rules and permissions, review the private draft, and deliberately confirm publication. Optional AI analysis can be skipped; no assistant provider is configured by this deployment.

Free candidate preparation runs in the browser and does not require candidates to install Docker. The Docker worker belongs to the trusted platform operator and independently checks uploads for both processing modes. Keep that operator computer awake and connected while accepting uploads. An uploader-controlled local check cannot substitute for platform safety acceptance.

The temporary QA worker was stopped after verification. No cloud coding session is presumed to keep a scanner running between sessions. When the worker heartbeat expires, `/api/capabilities` blocks uploads while `/api/ready` and public archive reads remain available. A saved finalizing original can resume validation after the worker returns.

## Deliberately inactive or unaccepted

Paid processing entitlement checks and the fully hosted scanner image are implemented, but checkout, subscription activation, renewals and paid Render provisioning remain inactive. The owner chose to defer billing. No paid service was created.

The full 44-unit lifecycle acceptance registry remains pending. This first-upload release does not assert independent human security certification, complete independent backup/restore acceptance, automated dissemination, or an always-on production summary-render worker. No external candidate invitations or actual positions were sent or published. Further work must preserve these distinctions.
