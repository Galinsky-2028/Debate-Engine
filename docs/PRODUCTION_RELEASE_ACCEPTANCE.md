# Production release evidence gate (PDE-44)

Production readiness is **not** a synonym for merged pull requests, a healthy preview, passing unit tests, or an approved development plan. Run `npm run release:check` locally or in the dedicated CI check to see the current seven operational blockers. The command reads only `registry/prs.json` and `registry/production-acceptance.json`, never deploys or mutates Neon or Render.

Each gate needs a dated acceptance record, a named reviewer, and a link to inspectable evidence (such as a documented test report). The canonical registry must also record `accepted` for every gate. The owner's standing policy permits substantive AI-assisted review and tests; an external human auditor is not a prerequisite. Review provenance must say what actually occurred. A passing test or merged PR alone does not supply evidence for unrelated operational gates.

Required areas: verified candidate identity governance; distinct-account browser pilot; isolated media worker; authorized external distribution; independent backup + real restore; independent security/privacy/accessibility review; and explicit production release authorization.

**Do not mark these accepted without actual evidence.** The initial evidence file intentionally lists all gates pending. Deployment is now explicitly authorized by the owner in this conversation. Missing credentials, network access, failing required checks and unverified service operation remain concrete blockers; external review stays distinct from automated validation.

The runtime `/api/ready` endpoint also verifies the exact migration checksums shipped in the release, the required schema tables, authentication signing configuration and storage bindings. A database containing only the original debate/media tables must not report readiness for newer sequence and branch-rule APIs. Basic runtime readiness still does not establish scanner signature coverage, successful live sign-in or full production acceptance.
