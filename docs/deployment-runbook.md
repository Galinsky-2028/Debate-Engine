# Deployment runbook (Render + Neon)

Current bindings are in [INFRASTRUCTURE.md](INFRASTRUCTURE.md): Render service `srv-dbp9png8v5cc73dkk830` (free plan, Docker runtime, `./Dockerfile`, branch `main`, **manual deploys**) at https://public-debate-engine.onrender.com, and Neon project `cool-dawn-42333373` (production branch `br-tiny-haze-bdurpbbb`, validation branch `br-silent-haze-bd3zazgn`). Do not create new services, projects or paid resources without owner authorization.

## What the container does

`Dockerfile` builds the app, prunes dev dependencies (keeping `pg`), runs as `node` and starts with:

```sh
node scripts/migrate.mjs && exec npm run start
```

Pending migrations are applied in one transaction under an advisory lock before the server listens. If a migration fails, the transaction rolls back, the container exits, Render marks the deploy failed and the previous release keeps serving. A changed, already applied migration file also stops startup (checksum mismatch).

## Required service environment

Set in the Render dashboard (never in Git): `DATABASE_URL` (production branch), `NEON_AUTH_BASE_URL` (same branch), `NEON_AUTH_COOKIE_SECRET` (≥ 32 chars), `PLATFORM_ADMIN_USER_IDS`, `PUBLIC_APP_ORIGIN=https://public-debate-engine.onrender.com`, `MEDIA_BUCKET`, `AWS_ENDPOINT_URL_S3`, `AWS_REGION`, `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`, and for the free plan `PDE_SCANNER_MODE=pull` and `SCANNER_WORKER_TOKEN` (≥ 64 random chars). Render supplies `PORT` and `RENDER_GIT_COMMIT`. `/api/ready` returns 503 when any of these is missing.

## Release procedure

1. Merge to `main` only with all CI checks green.
2. If the release adds migrations, apply them first to the validation branch (`DATABASE_URL=<validation> npm run db:migrate`) and run `npm run test:db` against a disposable database. Migrations must be additive and backward compatible with the running release.
3. Trigger a manual deploy of the merge commit in Render.
4. Verify:
   - `GET /api/health` → `{"status":"ok","version":"<deployed commit>"}`;
   - `GET /api/ready` → `status: ready`, `database: connected`;
   - run the read-only smoke: `PDE_PREVIEW_URL=https://public-debate-engine.onrender.com node scripts/smoke-preview.mjs` (also the "Live deployment smoke" workflow, which runs on every push to `main`).
5. Record the deploy id and commit where evidence is tracked ([acceptance-evidence.md](acceptance-evidence.md)).

## Rollback

Redeploy the previous commit from Render's deploy list. Because migrations are additive, the previous release runs against the newer schema. Never edit or reverse an applied migration; fix forward with a new numbered migration. If a migration itself must be undone, restore the database (see [backup-and-restore.md](backup-and-restore.md)) only with owner approval, because restoring discards later public events.

## Workers

No worker runs on the free plan. An operator runs, with the production environment:

- the laptop scanner (`/workspace/scanner`, `compose.scanner.yaml`) while uploads are accepted;
- `npm run worker:deadlines` to emit overdue events;
- `npm run worker:uploads:cleanup` (try `:dry-run` first) to abort expired multipart uploads;
- `npm run worker:render` (or `Dockerfile.worker`) only when a summary is queued.

The paid hosted image (`Dockerfile.production`, in-container ClamAV) and a background worker require cost approval. Cost rules: [OPERATIONS_AND_COST_CONTROLS.md](OPERATIONS_AND_COST_CONTROLS.md).

## Free-plan behaviour

The free instance sleeps when idle; the first request can take tens of seconds. The smoke test retries for a bounded window. Uploads pause whenever the scanner heartbeat is stale; reading is unaffected.
