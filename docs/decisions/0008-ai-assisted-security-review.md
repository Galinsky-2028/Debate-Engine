# ADR 0008: AI-assisted security review policy

**Status:** Accepted (owner policy in `AGENTS.md`, 2026-10-13).

## Context

Earlier planning text made an independent human security review a prerequisite for continuing implementation and release. No reviewer or budget was available.

## Decision

Development, testing, merging and deployment continue on substantive AI-assisted source and security review, threat analysis and automated adversarial/integration tests, with concrete findings fixed and evidence retained. The `securityReview` release gate (`packages/domain/release-gates.mjs`) is satisfied by an accepted entry, AI-assisted or external, with an attributed reviewer and linked, dated evidence; missing evidence still blocks (`release-gates.test.mjs`).

## Consequences

- External expert review stays recorded as pending follow-up ([E2EESA_ADOPTION.md](../E2EESA_ADOPTION.md), `security/e2eesa-status.json`).
- An AI self-review is never labelled an independent human audit, and no certification or conformance is claimed.
- Failed tests, unresolved vulnerabilities, missing credentials and required approvals remain blockers.
