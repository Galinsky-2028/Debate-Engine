# Accessibility test plan

Target: WCAG 2.2 Level AA for public reading and watching and for every candidate workflow (plan §15). Automated checks find only part of the failures; the manual matrix below is required before PDE-28/PDE-44 acceptance. Status on 2026-11-14: automated checks pass in CI; **no manual audit has been performed**.

## Automated (in CI on every pull request)

| Check | Where | Scope |
| --- | --- | --- |
| axe-core WCAG 2.0/2.1/2.2 A and AA rules | `scripts/browser-acceptance.mjs`, job `chromium-public` | `/`, `/debates`, `/candidates`, `/protocol`, `/sign-in`, at 1365 px and 375 px ([BROWSER_ACCEPTANCE.md](BROWSER_ACCEPTANCE.md)) |
| keyboard focus reaches navigation; no horizontal overflow at 375/390 px | same | public pages |
| two signed-in candidates complete a reciprocal debate in Chromium | `scripts/browser-two-candidate-pilot.mjs`, job `candidate-pilot` | workspace, composer, assessment, debate page ([TWO_CANDIDATE_BROWSER_PILOT.md](TWO_CANDIDATE_BROWSER_PILOT.md)) |
| caption parsing rejects markup and invalid times | `tests/captions.test.ts` | WebVTT import |

Gaps to add: axe on a populated debate page, embed, workspace pages and error states.

## Manual matrix (required for acceptance)

Run on fictional data on the validation branch; record date, tester, browser/AT version and findings in [acceptance-evidence.md](acceptance-evidence.md).

| Area | Tests | Tools |
| --- | --- | --- |
| Keyboard only | every control reachable, visible focus, logical order, no traps; player controls; upload, draft review, confirmation, assessment and policy forms | Chrome, Firefox, Safari |
| Screen readers | headings and landmarks; contribution labels name the candidate and medium; form errors and `role="status"` messages announced; qualification states readable without colour | VoiceOver (macOS, iOS Safari), NVDA (Windows), TalkBack (Android) |
| Media (SC 1.2.x) | captions present and synchronized (`<track kind="captions">`), reviewed vs machine-generated labelled, transcript reachable, meaningful visuals described or flagged; question timestamp links land on the right moment | real fictional clips |
| Reflow and zoom | 320 CSS px, 200 % and 400 % zoom, long names and titles, long captions | browsers |
| Contrast and non-colour cues | text, focus indicators, footnote/qualifying/awaiting badges | contrast checker |
| Timing | no client-side countdown is authoritative; session expiry messages are recoverable | manual |
| Error and empty states | expired session, scanner offline, 403/409 messages, empty archive | manual |

## Exit criteria

No open A/AA failure on public reading/watching or the candidate publish/assess/agree flows; media criteria met for every published item or the gap shown to viewers; results recorded with evidence. Performance targets (plan §15) are measured separately and are not part of this plan.
