# Repository naming and integration continuity

The product's canonical name is **Public Debate Engine**.

## Current state

The repository now lives at `Galinsky-2028/Debate-Engine`. It was transferred from `neophilism/Debate-Engine`; the transfer kept the same GitHub repository, history and pull request numbers. GitHub redirects the old `neophilism/Debate-Engine` path for web and git traffic, but a redirect is a courtesy that ends if a repository is ever created at the old path, so every reference inside this repository uses the new owner.

The repository **slug** is still `Debate-Engine`. Renaming the slug to `Public-Debate-Engine` is optional and is an owner decision that has not been made. Nothing in the code, the registry, CI or the deployment depends on it.

## What identifies the repository

- The canonical `registry/prs.json` carries `repository: "Galinsky-2028/Debate-Engine"`, and every `pullRequests[].url` uses that exact path; `registry/pr-contract.mjs` rejects anything else. The former path is kept only as history in `previousRepositoryNames`.
- `registry/roadmap.json` is a retired redirect. It carries the same `repository` value and must not become authoritative again.
- `.github/workflows/pr-registry.yml` runs only when `github.repository == 'Galinsky-2028/Debate-Engine'`, and the `validation` CI job runs `GITHUB_REPOSITORY=Galinsky-2028/Debate-Engine node scripts/validate-pr-registry.mjs`.
- `security/e2eesa-status.json` and `security/e2eesa-inventory.json` name `Galinsky-2028/Debate-Engine`. The upstream standard they pin, `neophilism/End-To-End-Everywhere-Security-Architecture-Standard`, is a different repository and is unchanged.
- Engine Room and Boardroom must reconcile the repository by immutable GitHub identity and canonical registry evidence, not by owner name.

## If the owner later renames the slug

1. Rename in GitHub Settings → General → Repository name.
2. In one commit: set `repository` in `registry/prs.json` and `registry/roadmap.json`, rewrite every `pullRequests[].url`, append the old full name to `previousRepositoryNames`, update the guard in `.github/workflows/pr-registry.yml` and the registry step in `.github/workflows/ci.yml`, the `repository` fields under `security/`, and the links in `README.md` and `docs/`.
3. Run `GITHUB_REPOSITORY=<owner>/<new-name> node scripts/validate-pr-registry.mjs`, `python3 scripts/validate_e2eesa_status.py` and `npm test`.
4. Confirm the Render service is still connected to the repository (deploys are manual from `main`; see [deployment runbook](deployment-runbook.md)). Do not create a replacement repository or a second Render service.

This repository is distinct from the independent, nonpolitical Live Debate Engine and from the later branded thin application **Interlocutor**.
