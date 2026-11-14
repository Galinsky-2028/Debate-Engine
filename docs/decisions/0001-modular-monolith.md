# ADR 0001: Modular monolith in one Next.js application

**Status:** Accepted (plan §3, PDE-02). **Date:** 2026-10-10.

## Context

The plan asks for one web application, a database, object storage and a media-worker boundary, and explicitly rejects a fleet of microservices. The plan's suggested `apps/` + `packages/` workspace layout was a recommendation, not a requirement.

## Decision

One Next.js 16 App Router application at the repository root serves the public site, the candidate workspace and all API routes. Domain rules live in framework-free `packages/domain/*`, server logic in `lib/server/*`, SQL in `packages/database/migrations/`. Untrusted media work runs in separate processes (`scripts/render-summary.mjs` with `Dockerfile.worker`, the operator scanner with `Dockerfile.scanner`), not in request handlers beyond bounded validation.

## Consequences

- One deploy unit and one dependency tree; a single free Render web service can host it.
- Domain rules are unit-testable without Next.js (`tests/*.test.ts`).
- The plan's separate `packages/ui` and `apps/reference-web` do not exist; downstream sites use `/api/v1`, embeds and `packages/sdk`.
- Boundaries are enforced by convention (`server-only` imports, review), not by package isolation.
