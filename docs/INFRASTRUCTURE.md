# Current infrastructure binding (owner replaced targets November 9, 2026)

- GitHub: https://github.com/Galinsky-2028/Debate-Engine
- Render workspace: `tea-dbl0kcbm8hqs738ptf3g` (Phillip's workspace).
- Live Render service: `srv-dbp9png8v5cc73dkk830`, https://public-debate-engine.onrender.com, free plan, Ohio, `main`, manual deploys. First live deploy: `dep-dbp9po08v5cc73dkk8u0`, commit `a82af3ca03960ffcc8119cb8cb08f6d32476a468`. See [first-upload evidence](FIRST_UPLOAD_DEPLOYMENT.md).
- Neon project: `cool-dawn-42333373` (Public Debate Engine), Ohio, PostgreSQL 17, free plan.
- Production branch: `br-tiny-haze-bdurpbbb`, database `debate`.
- Isolated validation branch: `br-silent-haze-bd3zazgn`.
- Private media bucket: `debate-originals`, Neon S3-compatible storage. Never expose its write credentials in browser code.
- Auth: Managed Better Auth on the production branch, Google and verified email accounts. The owner's chosen sign-in email is `galinsky2028@gmail.com`; administrator privileges are bound to its provisioned immutable Auth user ID via the runtime secret configuration, never granted by email matching.
- Initial host: free Render web service plus an authenticated operator-laptop scanner. Keep paid `Dockerfile.production` available but do not provision paid compute without cost approval. See [laptop processing](LAPTOP_PROCESSING.md).
- Paid account billing: deliberately inactive. Hosted preparation requires a server-stored entitlement; there is no public self-upgrade API.

The owner explicitly said to forget the inaccessible old resources and use the connected Render/Neon accounts. The historical targets below are retained as history and are not current deployment destinations.

## Historical binding (2026-10-10)

These identifiers were supplied by the project owner. They are **targets**, not evidence that deployment is running.

- GitHub: https://github.com/neophilism/Debate-Engine
- Render **project**: https://dashboard.render.com/project/prj-db5cv0nlot8c73eh9nng
- Neon **project**: `rapid-moon-08277391`
- Neon **production branch**: `br-autumn-hall-b5e4r3l2`
- Neon console: https://console.neon.tech/app/projects/rapid-moon-08277391/branches/br-autumn-hall-b5e4r3l2

The initial inspection found an empty GitHub repository, no existing published application tables on the designated Neon branch, and no Render web service associated with the Debate-Engine repository in the accessible workspace. Do not report a live deployment until a real service, matching repo/branch, running release, and readiness check have all been verified.

## Planned configuration

`DATABASE_URL` must refer to the specified Neon project. Application runtime must not use a development branch as production. Secrets must be configured through the authorized infrastructure and never committed. Persistent media storage and a separate worker are not configured yet.

Use a separate database branch for development migrations. Do not run schema migrations against production without testing, review, and a deployment rollback path.

A Render **project URL** by itself does not identify an existing deployable web service or authorize paid-plan creation.
