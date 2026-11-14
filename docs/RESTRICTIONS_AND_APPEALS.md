# Exceptional restrictions and appeals (PDE-26)

Implements DEVELOPMENT_PLAN §4.1 (safety administrators are separate from debate adjudication; campaign ownership is not moderation authority), §14.3 (exceptional restrictions with categories, independent review where feasible, appeal and a non-misleading public notice) and the §17 rows "A attempts to delete, hide…" and "A safety restriction is appealed".

## What it does

A platform safety administrator (an id in `PLATFORM_ADMIN_USER_IDS`) can open a **restriction case** on one published item: a submission, a supporting document or a released derivative. While the case is active:

- The item **stays in the public record**: its row, attribution, date, contribution counts, branch counts and qualifying-sequence position are unchanged. Nothing in `submissions`, `submission_documents` or `derivative_artifacts` is updated or deleted.
- In place of its media or text, the debate page shows a notice with the category label, the date, the public notice text and the appeal status (`app/debates/[id]/restriction-notice.tsx`, rendered by `published-contribution.tsx`, which also covers the qualifying-sequence player and the embed).
- `GET /api/media/[id]/play`, `GET /api/media/[id]/captions`, `GET /api/documents/[id]/download`, and derivative `download`/`preview` return **HTTP 451** with the public notice.
- `loadPublicDebate` (and therefore `/api/debates/[id]`, `/api/v1/debates/[id]`, the sequence endpoint and the embed) returns `written_content: null` plus a `restriction` object for the row.
- Caption/transcript search (`/api/search`) and writing search in `listPublicDebatesPage` skip restricted bytes; the debate itself is still listed and counted.
- `publicDocuments` and the press kit list restricted documents as "Restricted supporting material" with filename `withheld` and no download path; restricted originals and summaries have `publicPath: null` and the notice. A released derivative is also treated as restricted while any clip source submission is restricted.
- The RSS feed lists joint policy agreements only and never carried contribution bytes, so it needed no change.

**Lifting** a case restores everything immediately. The full history stays public.

## Rules enforced in SQL (migration `0024_restriction_cases.sql`)

- `restriction_cases`: categories are `malware_or_security`, `unlawful_content`, `private_information`, `legal_order` and `impersonation`. At most one active case per target. The target must be a published item, and `debate_id` must match it. The only allowed update is `active → lifted`, and only after a `lifted` event exists. A lifted case is final, so restricting again needs a new case. Cases cannot be deleted.
- `restriction_events` are append-only (`pde_block_any_mutation`). `event_order` is assigned under a row lock on the case and `occurred_at` cannot go backwards. Allowed sequence: `opened` (first, by the opener) → `appealed` ↔ `upheld` … → `lifted`. `upheld` needs a pending appeal. Nothing follows `lifted`.
- **Defense in depth: campaign ownership is never moderation authority.** The opener of a case, and anyone who upholds or lifts it, must not own any participating candidacy in that debate (the originator or any branch responder), and must not hold an active campaign membership for one.
- An appeal must come from the account that owns the candidacy that published the item. For a document this is the uploader; for a derivative it is the approving candidacies.
- `independent_review` must equal "the decider is a different account from the opener". The application can only record this truthfully.
- Public notice: 20–1000 characters, and it must not contain the private basis. At commit time, a case without its `opened` event and a `lifted` event without the matching case status are rejected (deferred constraint triggers).
- Helper SQL functions: `pde_active_restriction_case(kind,id)` (kinds `submission`, `media`, `document`, `derivative`) and `pde_public_restriction(kind,id)` (public fields only).

## Application rules (`lib/server/restrictions.ts`, `packages/domain/restrictions.ts`)

- `openRestriction` checks that the public notice does not share a run of six consecutive words with the restricted material (written text, published captions, document label and filename, or derivative captions) or the private basis.
- `decideAppeal`: when more than one admin id is configured, the opener cannot decide their own case (403). With a single admin, the same admin may decide and `independent_review=false` is shown publicly as "decided by the opening administrator".
- An appeal statement (25–4000 characters) is stored only as `private_basis`. Its public notice is fixed: "The contributor has appealed this restriction."
- Every step appends `publication_events` (`restriction_opened|appealed|upheld|lifted`, with no account ids and no private basis) and `audit_events`.

## Endpoints

| Method | Path | Who |
|---|---|---|
| GET/POST | `/api/admin/restrictions` | platform admin (list with private basis / open) |
| POST | `/api/admin/restrictions/[id]/decide` | platform admin, `{decision:"uphold"|"lift", publicReason, privateBasis?}` |
| POST | `/api/restrictions/[id]/appeal` | the affected contributor, `{statement}` |
| GET | `/api/v1/debates/[id]/restrictions` | public history; documented in `contracts/openapi.yaml` |

UI: `/workspace/admin/restrictions` (admin), plus a restriction history and appeal form on the debate page (`restriction-history.tsx`, `restriction-appeal.tsx`).

## Tests

- `tests/restrictions.db.integration.mjs` exercises the real migrated SQL and the production query strings. It covers:
  - An originator-admin, a responder and an opponent's delegate cannot open or decide.
  - Non-contributors cannot appeal.
  - Independence is recorded truthfully.
  - Events and cases cannot be rewritten or deleted.
  - A lifted case is final.
  - The restricted row and counts stay while its text is withheld from the record and from search.
  - Lifting restores the item.
  - The private basis, the appeal statement and account ids never appear in public results.
  - Document restriction works.
- `tests/restrictions.test.ts` covers the pure rules.

## Honest limits

- Independent review means "a different platform administrator". It is not an external audit, and no external reviewer is in place. External expert review stays pending.
- The no-repeat check is heuristic (shared six-word runs). Administrators must still write notices carefully.
- Question texts, answers, corrections and assessments attached to a restricted submission stay visible. A harmful question would need its own target kind; this is not built.
- The 451 responses and the redaction cover the routes listed above. Object-storage URLs that were signed before a restriction expire within their 300-second lifetime.
- HTTP-level route tests need Neon Auth sessions and are not automated. The route logic is covered through the shared SQL and the database triggers.
