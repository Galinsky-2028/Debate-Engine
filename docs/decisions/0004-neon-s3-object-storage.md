# ADR 0004: Private Neon S3-compatible storage for originals

**Status:** Accepted (November 9, 2026 infrastructure replacement). Supersedes the plan's Backblaze B2 preference.

## Context

Originals must not live in Postgres or on Render's ephemeral filesystem. The owner directed use of the connected Neon account; no paid storage was authorized.

## Decision

Store originals, documents and rendered summaries in the private bucket `debate-originals` through the S3 API (`@aws-sdk/client-s3`, path-style, `AWS_ENDPOINT_URL_S3`). Objects are never public; reads use five-minute signed URLs. Keys are unique per object; the database records SHA-256 and size.

## Consequences

- Any S3-compatible provider can replace it by changing endpoint and credentials; the recovery rehearsal uses local RustFS ([S3_RECOVERY_REHEARSAL.md](../S3_RECOVERY_REHEARSAL.md)).
- Object Lock / retention policy is not configured; independent object backup is an open release gate ([backup-and-restore.md](../backup-and-restore.md)).
- Incomplete multipart uploads must be aborted by `npm run worker:uploads:cleanup` or a lifecycle rule.
