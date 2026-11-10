# Production release evidence gate (PDE-44)

Production readiness is **not** a synonym for merged pull requests, a healthy preview, passing unit tests, or an approved development plan. Run `npm run release:check` locally or in the dedicated CI check to see the current seven operational blockers. The command reads only canonical `registry/prs.json` and `registry/production-acceptance.json`, never deploys or mutates Neon or Render.

Each gate needs a dated acceptance record, an attributed reviewer, and a link to inspectable evidence (such as a documented test report). Under the October 13 owner policy in AGENTS.md, substantive AI-assisted review and relevant tests can satisfy the security review; an independent human audit and certification remain separately tracked follow-up work. The canonical registry must also record `accepted` for every gate. Missing operational approval keys fail closed.

Required areas: verified candidate identity governance; distinct-account browser pilot; isolated media worker; authorized external distribution; independent backup + real restore; independent security/privacy/accessibility review; and explicit production release authorization.

**Do not mark these accepted without actual evidence.** Full lifecycle acceptance remains distinct from a limited first-upload deployment. The owner authorized deployment in the November 9 session, replacement infrastructure, laptop preparation for free accounts, and preparation of paid processing with billing deferred. No automated invitations, external dissemination, or charges are authorized by those choices.
