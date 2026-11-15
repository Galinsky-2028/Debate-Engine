# $0 PostgreSQL backup and restore rehearsal (PDE-26)

The public repository CI job now exercises a **real PostgreSQL 18 full dump and restore** against a freshly migrated disposable database containing two **explicitly fictional** candidates, published written speeches, a question, an answer, a candidate assessment, and an immutable correction. It uses pg_dump custom format, creates a fresh second database, restores the complete database schema and contents with pg_restore, checks a canonical all-table row digest, and confirms that the restored immutable speech still cannot be overwritten.

Run \`npm run test:db:restore-rehearsal\` only inside a local test runner with the \`PDE_TEST_POSTGRES_CONTAINER\` set to the local Postgres service container ID. The script refuses remote databases, production credentials, non-CI database names, and non-CI account roles. It removes the temporary dump and restored database after the test.

**This does not satisfy the independent backup/restore production gate.** No real candidate data, production credentials, object-storage originals, or offsite destination are used. The test merely verifies that the database export/restore mechanism and immutability survive an actual round trip. The final operational gate still needs (a) a secure independent destination for encrypted backups of approved real data, (b) a complete media-object backup with SHA-256 verification, (c) a real recovery rehearsal performed by an authorized operator, and (d) dated independent reviewer evidence. Never upload confidential originals, live database dumps, or secret environment variables to a public GitHub repository or CI artifact.

## Neon point-in-time restore rehearsal on the development branch (2026-11-15)

This rehearsal used only the development validation branch `br-silent-haze-bd3zazgn` (`launch-validation-20261110`) in Neon project `cool-dawn-42333373`. The production branch `br-tiny-haze-bdurpbbb` was not touched. All calls went through the Neon REST API.

1. Created branch `br-broad-band-bd66fhx8` (`restore-rehearsal-20261115`) from the development branch at the point in time `2026-11-15T18:24:51Z`. That is inside the project's 6-hour history window. Neon resolved it to LSN `0/1CBDD20`, the branch's last change on `2026-11-10T04:13:16Z`.
2. Fetched the `debate` database schema of both branches (`GET /branches/{id}/schema`). They were byte-identical: 118,554 bytes, SHA-256 `b51a94c89b611c0f7a9d36d3a88ab7c87ce1f195a47dc71eaf98c75f4a9bdc85`, 49 tables, 37 triggers.
3. Deleted the rehearsal branch and confirmed that only the production and development branches remain.

**What this shows:** Neon's history-based point-in-time recovery restores a complete, identical schema, including the immutability and authorization triggers, from the development branch inside the retention window.

**What it does not show:**

- **Row-level contents.** This session's network policy blocks connections to Neon compute hosts, so row digests were not compared. The CI rehearsal above covers a full row-digest round trip.
- **Independence.** A Neon branch lives in the same provider and account. It is not an independent, offsite backup.
- **Recovery beyond 6 hours.** The history window is 6 hours.
- **Media objects.** See [S3_RECOVERY_REHEARSAL.md](S3_RECOVERY_REHEARSAL.md).

The `independentBackupRestore` gate stays pending.
