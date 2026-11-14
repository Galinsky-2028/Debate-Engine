# Backup and restore

Status: mechanisms are implemented and rehearsed on fictional data in CI; the **independent production backup/restore gate is not accepted** (`independentBackupRestore` in `registry/production-acceptance.json`).

## What must be recoverable together

1. Postgres: all tables, including append-only evidence (`publication_events`, assessments, endorsements, approvals, attestations, audit events) and `schema_migrations`.
2. Objects in the private bucket: originals, supporting documents, rendered summaries.
3. The link between them: each database row stores the object key, SHA-256 and size.

A restore is correct only if every published row's object exists with the recorded digest, and no public event published after the backup is silently lost (plan §13.3, §17).

## Database

- **Neon point-in-time restore** of a branch within the project's history window is the primary recovery path. Restore to a *new* branch first, verify, then switch `DATABASE_URL` (and the matching `NEON_AUTH_BASE_URL`) with owner approval.
- **Logical backup:** `pg_dump -Fc "$DATABASE_URL" > backup.dump` from an operator machine to encrypted storage outside Neon. Restore with `pg_restore --no-owner -d <empty database>`; `npm run db:check` must then report every migration as applied.
- **Rehearsal:** `npm run test:db:restore-rehearsal` (CI job `postgres-integration`) dumps and restores a migrated database with fictional candidates, compares a row digest and confirms immutability survives ([POSTGRES_RESTORE_REHEARSAL.md](POSTGRES_RESTORE_REHEARSAL.md)).

## Objects

- Copy the bucket with any S3 client to an independent destination (different provider/account, separate credentials), keeping keys.
- Verify by digest: `npm run audit:archive:full` streams every published object and compares SHA-256 and size ([ARCHIVE_AUDIT.md](ARCHIVE_AUDIT.md)).
- **Rehearsal:** `npm run test:s3:restore-rehearsal` (CI job `s3-recovery`) destroys a primary store and restores from a backup, rejecting a corrupted copy ([S3_RECOVERY_REHEARSAL.md](S3_RECOVERY_REHEARSAL.md)).

## Reconciliation after a restore

1. `npm run db:check` (schema complete, checksums match).
2. `npm run audit:archive:full -- --output=<private path>` (every published object present and matching).
3. Compare the latest `publication_events` time with the incident time; republish nothing automatically; record any gap publicly.
4. `GET /api/ready`, then the live smoke test.

## Open items for the production gate

An independent, encrypted, access-separated destination for both database dumps and objects; a scheduled backup; a real restore of the linked database and objects performed by an authorized operator; dated evidence; agreed recovery-point and recovery-time targets. None of these exists yet, and none may be claimed.
