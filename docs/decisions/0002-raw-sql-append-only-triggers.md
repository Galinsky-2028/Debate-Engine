# ADR 0002: Raw SQL through `pg` with append-only database triggers

**Status:** Accepted (PDE-03, PDE-25). **Date:** 2026-10-10, extended through migration 0020.

## Context

The product's core promise is that published contributions, questions, assessments and approvals cannot be silently changed or removed. Application checks alone can be bypassed by a bug.

## Decision

- Use parameterized SQL through `pg` (no ORM) inside explicit transactions (`lib/server/db.ts`).
- Numbered, additive migrations, applied once with SHA-256 checksums and an advisory lock (`scripts/migrate.mjs`); an applied file is never edited.
- Evidence tables get `BEFORE UPDATE OR DELETE` triggers calling `pde_block_any_mutation()`; published debates/submissions get publication-aware guards; ownership and branch rules are repeated in triggers (`0007_actor_integrity.sql`, `0014`, `0016`, `0017`, `0018`).

## Consequences

- Immutability holds even against a faulty route handler; tests assert it (`db.integration.mjs`, `schema.test.ts`).
- Corrections, reversals and withdrawals must be modelled as new rows.
- A privileged database owner can still disable triggers; this is defense in depth, not tamper-proofing ([DATABASE_INTEGRITY.md](../DATABASE_INTEGRITY.md)).
- Postgres 16 locally, 17 on Neon, 18 in CI: migrations avoid version-specific syntax.
