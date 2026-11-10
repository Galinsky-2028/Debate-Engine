# Local and hosted processing

The owner selected these modes on November 9, 2026:

- Free accounts prepare their file in a browser Web Worker, including a SHA-256 digest and bounded MP4 movie-duration parsing. Current Chrome, Edge, Firefox and Safari run this on Mac, Windows and Linux without installing a candidate app. Files remain unedited and are not rendered to prepare them. Unsupported local metadata formats fall back to the platform's authoritative FFprobe validation.
- Paid entitlements allow skipping browser metadata preparation and using hosted preparation. The API checks the account's stored `processing_tier`, never a client-supplied subscription claim. Billing, checkout, paid activation and automatic renewals are intentionally inactive. No account has been charged or silently upgraded.
- Both modes require independent malware scanning, authoritative hashing, FFprobe validation, candidate authorization and deliberate publication consent. A candidate cannot self-certify their own file as safe.

## Free hosting with an operator laptop scanner

Set `PDE_SCANNER_MODE=pull` and a cryptographically random `SCANNER_WORKER_TOKEN` of at least 64 characters on the web service. A verified platform administrator downloads `scanner.env` from `/workspace/scanner`. This file contains only an HTTPS app origin and a narrowly scoped scanner token, not a database password or storage credential. Never share it with candidates, commit it, or upload it to a public folder.

Install Docker Desktop (Mac/Windows) or Docker Engine with Compose (Linux), extract the repository next to the downloaded `scanner.env`, then run:

```sh
docker compose -f compose.scanner.yaml up --build
```

The worker downloads official ClamAV signatures, verifies original bytes against the server's exact SHA-256 and size, scans using the real local ClamAV socket, then returns the verdict over authenticated HTTPS. Jobs have a two-minute, one-use lease. Different digests, wrong leases, expired leases and replayed results are rejected. Download URLs are limited to Neon storage HTTPS origins; redirects and oversized objects are rejected. The worker polls outbound only, with no exposed laptop ports. It cannot publish a contribution or grant an entitlement.

Allow 2 GB RAM. The first signature download may take several minutes; a Docker volume retains signatures between starts. The worker checks for updates throughout operation. Stopping the worker, closing the laptop or losing connectivity pauses new media uploads after its short heartbeat expires. Public records remain readable. A saved, finalizing original can retry completion without uploading its bytes again. Stopping local preparation never publishes anything.

The operator worker is separate from each candidate's local browser preparation. It is a trusted platform component, not an ordinary uploader-controlled safety assertion. Running that component on a laptop avoids a paid always-on scanner but makes upload availability depend on the operator's computer. A future fully hosted deployment removes that dependency.

## Fully hosted mode retained

`Dockerfile.production` runs Next.js, a local ClamAV scanner under a separate Unix identity, an official-signature updater, and a supervisor. It requires a suitably sized paid host; the tested scanner uses approximately 1 GB RSS before web traffic. Keep `PDE_SCANNER_MODE` unset for this topology. Startup fails if official signatures cannot be loaded; scanner/updater exit terminates the instance. No fixture signatures are accepted. Paid hosting requires explicit cost authorization.

## Operations

Rotate `SCANNER_WORKER_TOKEN` on Render to revoke a pairing, redeploy, and download a new pairing file. `/api/capabilities` reports whether uploads can currently proceed; `/api/ready` reports public-app readiness separately from a sleeping laptop worker. Never report first-video availability solely from a successful container build. Verify the actual scan, immutable attestation and publication flow.

The complete debate lifecycle's separate release checklist is not marked accepted by this setup. Automated distribution, independent backups/restore acceptance and independent human security review remain separately documented.
