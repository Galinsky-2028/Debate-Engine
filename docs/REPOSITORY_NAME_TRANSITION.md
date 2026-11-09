# Repository naming and integration continuity

The product's canonical name is **Public Debate Engine**. The currently hosted GitHub repository slug is `Galinsky-2028/Debate-Engine`, confirmed by cloning its current origin. GitHub redirects the historical `neophilism/Debate-Engine/pull/87` URL to the same PR under the new organization. Canonical PR links follow that verified transfer; historical PR numbers, IDs, states and observation timestamps remain unchanged. The earlier approved product-name rename to `Public-Debate-Engine` is separate from this observed organization transfer.

The connected GitHub integration does not currently offer a repository-rename operation. The slug has **not** been changed. An authorized repository administrator should use GitHub Settings → General → Repository name to apply `Public-Debate-Engine`, after checking GitHub Pages, CI, webhook permissions and links.

After the slug changes, confirm GitHub's old URL redirect and update the `repository` field of the canonical `registry/prs.json`. Preserve `Debate-Engine` as a historical alias only through a validated shared-registry contract change; do not add an unrecognized field ad hoc. `registry/roadmap.json` is a retired redirect and must not become authoritative again. Engine Room must reconcile the renamed repository by immutable GitHub identity and canonical registry evidence.

Verify Render's GitHub repository connection, automated deploy webhook, Neon/project-bound environment variables, and all internal GitHub links. Do not provision a replacement repository or detach Render's existing service.

This is distinct from the independent, nonpolitical Live Debate Engine and the later branded thin application **Interlocutor**.
