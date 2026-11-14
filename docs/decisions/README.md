# Architecture decision records

Short records of decisions that are visible in the repository. Each states the context, the decision, its consequences and where it is implemented. A superseded record is kept and marked, never rewritten.

| ADR | Decision | Status |
| --- | --- | --- |
| [0001](0001-modular-monolith.md) | Modular monolith in one Next.js application | Accepted |
| [0002](0002-raw-sql-append-only-triggers.md) | Raw SQL through `pg` with append-only database triggers | Accepted |
| [0003](0003-neon-auth.md) | Neon Auth (managed Better Auth) for identity | Accepted |
| [0004](0004-neon-s3-object-storage.md) | Private Neon S3-compatible storage for originals | Accepted |
| [0005](0005-operator-laptop-scanner.md) | Operator-laptop scanner on free hosting | Accepted |
| [0006](0006-database-jobs-and-outbox.md) | Database-backed jobs and outbox instead of Redis | Accepted |
| [0007](0007-no-llm-dependency.md) | No LLM dependency; optional private assistant adapter | Accepted |
| [0008](0008-ai-assisted-security-review.md) | AI-assisted security review policy of 2026-10-13 | Accepted |
