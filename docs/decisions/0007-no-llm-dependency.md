# ADR 0007: No LLM dependency

**Status:** Accepted (plan §11.3, October 11 expansion).

## Context

The debate must operate when no AI provider is available, and AI must never judge a debate.

## Decision

Every protocol, summary and rendering path is deterministic and works without a model. The private Debate Assistant (`lib/server/assistant-model.ts`) is an optional adapter to an OpenAI-compatible HTTPS endpoint configured by `DEBATE_ASSISTANT_*` (or the Neon AI gateway). It runs only with per-draft provider consent, validates and grounds the model output (`packages/domain/private-assessment.ts`, `assistant-quality.ts`) and otherwise reports "unavailable" without inventing findings.

## Consequences

- No provider is configured in the current deployment; candidates publish by skipping the review explicitly.
- Assistant output is private and never affects assessments, qualification or any public read.
