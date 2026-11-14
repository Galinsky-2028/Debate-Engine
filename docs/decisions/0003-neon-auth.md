# ADR 0003: Neon Auth for identity

**Status:** Accepted (PDE-04). **Date:** 2026-10.

## Context

Candidates need real accounts with verified email, and administrators must not be identified by email matching. Building password handling in-house is unnecessary risk.

## Decision

Use Neon Auth (managed Better Auth bound to the Neon branch) via `@neondatabase/auth`, proxied same-origin under `/api/auth/*`. The application stores only `identity_provider='neon-auth'` and the immutable `external_subject`. Administrators are listed by Auth user id in `PLATFORM_ADMIN_USER_IDS`. Candidate eligibility is a separate, reviewed verification step.

## Consequences

- Each Neon branch has its own Auth instance; `NEON_AUTH_BASE_URL` must match the branch in `DATABASE_URL`.
- Google sign-in and verified email are configured in the Neon console, not in code.
- Sign-in alone never grants candidate powers ([AUTH_AND_VERIFICATION.md](../AUTH_AND_VERIFICATION.md)).
- CI's two-candidate pilot replaces the auth module only inside the CI checkout (`scripts/install-ci-pilot-auth.mjs`); production cannot enable it.
