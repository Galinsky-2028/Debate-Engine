# Current deployment target and access

The owner explicitly requested completion and deployment in this conversation on November 9, 2026. This authorizes deployment to the existing designated infrastructure; no paid services, unrelated projects or real candidate submissions are authorized by that request.

- Repository: `Galinsky-2028/Debate-Engine`.
- Source branch: `finish-debate-platform`.
- Render project: `prj-db5cv0nlot8c73eh9nng`.
- Existing Render web service: `srv-db5j814s728c738161ig`.
- Existing service URL: `https://public-debate-engine-preview.onrender.com` (not verified reachable in this environment).
- Neon project: `rapid-moon-08277391`; production branch `br-autumn-hall-b5e4r3l2`. Recheck the actual target and backup before applying tested migrations 0019–0021; local tests use separate disposable databases.

## Observed environment access

The environment now reports `RENDER_API_KEY` and `NEON_API_KEY` ready. Both names are present in the running process. No values were printed or copied into repository files. Native Git read and branch-push preflight succeed through the existing platform authentication; do not request another GitHub token merely because API networking is blocked.

Fresh authenticated requests to the Render and Neon APIs still fail at the proxy CONNECT step with HTTP 403. GitHub REST/GraphQL and the existing Render site's HTTPS requests are also denied. These are observed network-policy blocks, not evidence that the keys are invalid or that the remote application is down.

Required environment network additions:

- `api.render.com`
- `console.neon.tech`
- `api.github.com`
- `public-debate-engine-preview.onrender.com`

After inspecting the existing service, any actual Neon Auth, database and object-store hostnames needed for direct validation must also be allowed. Do not guess hosts, replace an unreadable draft allowlist, request duplicate keys, or expose credentials in chat.

The configuration draft service repeatedly returns “The current environment draft could not be verified.” No publish operation is exposed to this chat. The user must save/publish through the environment interface; no successful publication or draft update is claimed here. Existing newly supplied key bindings were preserved.

## Continue deployment when access is available

1. Read the exact existing Render service, environment and project through the API, and confirm repository, branch and resource placement. Inspect configured binding names and reuse existing service credentials; do not provision replacements based on missing local variables.
2. Confirm the exact release commit and required CI results. The existing workflow now runs on pushed development branches as well as pull requests/main, so the release branch can receive CI without relying on a blocked PR-create API.
3. Confirm Neon project/branch identity, capture a recoverable backup, apply the already tested additive migrations to the approved deployment database, and run checksum verification. Never point synthetic tests at the hosted database.
4. Deploy the exact tested commit to the existing Render service. Do not change its plan, create a worker or change unrelated services without applicable spending authorization.
5. Wait for Render to report that exact commit live. Validate `/`, `/api/health`, `/api/ready`, and `/api/capabilities`, then perform real sign-in, publication, reciprocal assessment and media checks with authorized accounts/material. Keep unavailable capabilities explicitly blocked.
6. Record the real service/deploy ID, commit, readiness, limitations and rollback result. A source push, deploy request or healthy empty homepage alone does not establish a working complete debate platform.
