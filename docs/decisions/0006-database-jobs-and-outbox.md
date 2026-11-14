# ADR 0006: Database-backed jobs and outbox instead of Redis

**Status:** Accepted (plan §13.1, PDE-03/PDE-14).

## Context

Deadlines, rendering and future dissemination must survive restarts, never run twice and never fabricate a sent state. The plan avoids mandatory Redis.

## Decision

`durable_jobs` (unique `job_type` + `dedupe_key`, leases with owner and token, attempt counts, `last_error`) and `outgoing_actions` (unique action/destination/dedupe key; states `pending`, `sending`, `accepted`, `failed`) in Postgres. Workers claim with `FOR UPDATE SKIP LOCKED`. Jobs are enqueued in the same transaction as the state change that requires them.

## Consequences

- Exactly-once effects come from unique keys plus transactional writes, not broker semantics (`deadline-worker.test.ts`).
- No scheduler exists on the free plan; workers are run as CLIs by an operator. Overdue labels are computed at read time, so they stay correct without the worker.
- `outgoing_actions` is unused until dissemination lands ([DISSEMINATION_AND_NOTIFICATIONS.md](../DISSEMINATION_AND_NOTIFICATIONS.md)).
