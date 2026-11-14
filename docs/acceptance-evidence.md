# Acceptance evidence index

Where the evidence for each of the 44 approved work units lives. **Automated evidence** runs in CI (`.github/workflows/ci.yml` jobs in brackets, `security-source.yml` for CodeQL/audit) and proves source behaviour on fictional data. **Pending** lists what automated evidence cannot prove. As of 2026-11-14 every unit's `acceptance` in [`registry/prs.json`](../registry/prs.json) is `pending` and every production gate in `registry/production-acceptance.json` is `pending`; `npm run release:check` exits 2. Merged PRs are listed per unit in the registry and are not repeated here. Merged work is not accepted production operation.

Production gates (all pending): candidate identity governance, distinct-account browser pilot with real accounts, worker deployment, external distribution, independent backup and restore, security review (AI-assisted or external, with dated evidence), production release authorization ([PRODUCTION_RELEASE_ACCEPTANCE.md](PRODUCTION_RELEASE_ACCEPTANCE.md)).

| Unit | Automated evidence | Docs | Pending (operational / manual) |
| --- | --- | --- | --- |
| PDE-01 Plan and handoff | `pr-registry.test.mjs` [validation] | [DEVELOPMENT_PLAN](DEVELOPMENT_PLAN.md), [spec/](../spec/debate-protocol.md), [agent-handoff](agent-handoff.md) | Engine Room reconciliation of this handoff |
| PDE-02 Web foundation and CI | typecheck, build, `request-origin.test.ts` [validation] | [local-development](local-development.md) | — |
| PDE-03 Schema and integrity | `schema.test.ts`, `db.integration.mjs` [postgres-integration] | [DATABASE](DATABASE.md), [DATABASE_INTEGRITY](DATABASE_INTEGRITY.md) | upgrade rehearsal on a copy of production |
| PDE-04 Auth and campaign permissions | `db.integration.mjs`; pilot [candidate-pilot] | [AUTH_AND_VERIFICATION](AUTH_AND_VERIFICATION.md), [CAMPAIGN_DELEGATION](CAMPAIGN_DELEGATION.md) | real-account sign-in; delegate revocation matrix in a browser |
| PDE-05 Candidacy verification | pilot [candidate-pilot] | [CANDIDACY_VERIFICATION_PROCESS](CANDIDACY_VERIFICATION_PROCESS.md), [VERIFICATION_REVIEW_UI](VERIFICATION_REVIEW_UI.md) | published verification standard; real candidate verified; invitations ([INVITATIONS](INVITATIONS.md)) |
| PDE-06 Reciprocal rules | `protocol.test.ts`, `deadlines.test.ts`, `modalities.test.ts` | [spec/debate-protocol](../spec/debate-protocol.md) | branch rule versions ([BRANCH_RULE_VERSIONS](BRANCH_RULE_VERSIONS.md)) |
| PDE-07 Uploads | `upload-parts.test.ts`, `upload-maintenance.test.mjs`, `uploads.db.integration.mjs` | [MEDIA_PUBLICATION](MEDIA_PUBLICATION.md), [UPLOAD_SCANNER_STATUS](UPLOAD_SCANNER_STATUS.md) | real browser resume test; files above 60 MiB |
| PDE-08 Media processing and captions | `clamav*.test.ts` [clamav-live], `media.integration.mjs` [real-media], `captions.test.ts`, `scan-attestation.db.integration.mjs`, `laptop-scanner.*` | [MALWARE_SCANNING](MALWARE_SCANNING.md), [REAL_CLAMAV_ACCEPTANCE](REAL_CLAMAV_ACCEPTANCE.md), [LAPTOP_PROCESSING](LAPTOP_PROCESSING.md), [CAPTIONS](CAPTIONS.md) | playback encodes; reviewed transcription workflow |
| PDE-09 Supporting documents | `archive-integrity.test.mjs` | [SUPPORTING_SOURCES](SUPPORTING_SOURCES.md) | — |
| PDE-10 Initiation and publication | `confirmation.test.ts`, `full-debate-pilot.db.integration.mjs`, pilot | [MEDIA_WORKROOM](MEDIA_WORKROOM.md) | first real opening by the candidate |
| PDE-11 Response branches | `full-debate-pilot.db.integration.mjs`, `format.test.ts` | [NONQUALIFYING_PUBLIC_RESPONSES](NONQUALIFYING_PUBLIC_RESPONSES.md), [RECIPROCAL_IMPLEMENTATION](RECIPROCAL_IMPLEMENTATION.md) | — |
| PDE-12 Assessments and objections | `protocol.test.ts`, `sequence.test.ts`, pilot | [CONTESTED_ASSESSMENTS](CONTESTED_ASSESSMENTS.md) | — |
| PDE-13 Qualified sequences | `sequence.test.ts`, `protocol.test.ts` | [QUALIFYING_SEQUENCE_UI](QUALIFYING_SEQUENCE_UI.md) | persisted versioned manifests ([BRANCH_RULE_VERSIONS](BRANCH_RULE_VERSIONS.md)) |
| PDE-14 Deadlines and notifications | `deadlines.test.ts`, `deadline-worker.test.ts`, `obligation-wiring.test.ts` | [DEADLINES_AND_NOTIFICATIONS](DEADLINES_AND_NOTIFICATIONS.md) | scheduled worker; outage adjustment flow; real notifications ([DISSEMINATION_AND_NOTIFICATIONS](DISSEMINATION_AND_NOTIFICATIONS.md)) |
| PDE-15 Public debate pages | axe/browser [chromium-public], pilot | [PUBLICATION_REGRESSION](PUBLICATION_REGRESSION.md) | — |
| PDE-16 Player and transcript search | `captions.test.ts`, browser | [CAPTIONS](CAPTIONS.md) | manual screen-reader and mobile playback ([accessibility-test-plan](accessibility-test-plan.md)) |
| PDE-17 Discovery | `discovery.test.ts`, `pagination.test.ts`, browser | [DISCOVERY](DISCOVERY.md) | representative mobile screenshots with real data |
| PDE-18 Candidate workspace | pilot [candidate-pilot] | [MEDIA_WORKROOM](MEDIA_WORKROOM.md) | multi-round debate by real candidates via UI only |
| PDE-19 Policy agreements | `policy-endorsement.db.integration.mjs`, `public-policy-queries.db.integration.mjs` | [POLICY_CONVERGENCE](POLICY_CONVERGENCE.md) | scoped partial agreements |
| PDE-20 Media permissions | `protocol.test.ts`, `rights.test.ts` | [DERIVATIVE_RIGHTS](DERIVATIVE_RIGHTS.md) | prospective revocation of optional uses |
| PDE-21 Summary production | `summary.test.ts`, `media.integration.mjs` | [VIDEO_SUMMARY_PIPELINE](VIDEO_SUMMARY_PIPELINE.md), [CANDIDATE_SUMMARY_WORKROOM](CANDIDATE_SUMMARY_WORKROOM.md), [SUMMARY_WORKER_OPERATIONS](SUMMARY_WORKER_OPERATIONS.md) | deployed render worker; real joint approval |
| PDE-22 Press packages | `press-kit.test.ts`, `xml.test.ts`, `archive-audit-query.test.mjs` | [PRESS_KITS](PRESS_KITS.md), [SYNDICATION_AND_EMBEDS](SYNDICATION_AND_EMBEDS.md) | — |
| PDE-23 Dissemination | — | [DISSEMINATION_AND_NOTIFICATIONS](DISSEMINATION_AND_NOTIFICATIONS.md) | implementation in progress; authorized destinations |
| PDE-24 API and integration | `interlocutor.test.ts`, `contracts/openapi.yaml` | [PUBLIC_API](PUBLIC_API.md), [INTERLOCUTOR_BRAND_INTEGRATION](INTERLOCUTOR_BRAND_INTEGRATION.md) | downstream campaign integration |
| PDE-25 Security and E2EESA | CodeQL + `npm audit` [security-source], `validate_e2eesa_status.py` [e2eesa-status] | [security-and-E2EESA-applicability](security-and-E2EESA-applicability.md), [SECURITY_STATIC_ANALYSIS](SECURITY_STATIC_ANALYSIS.md), [ORIGIN_SECURITY](ORIGIN_SECURITY.md) | reviewed E2EESA inventory; dated security review entry; external review (follow-up) |
| PDE-26 Preservation and restore | `test:db:restore-rehearsal` [postgres-integration], `test:s3:restore-rehearsal` [s3-recovery], `archive-integrity.test.mjs` | [backup-and-restore](backup-and-restore.md), [ARCHIVE_AUDIT](ARCHIVE_AUDIT.md), [spec/archive-and-restriction-policy](../spec/archive-and-restriction-policy.md) | restrictions/appeals ([RESTRICTIONS_AND_APPEALS](RESTRICTIONS_AND_APPEALS.md)); account closure ([ACCOUNT_CLOSURE_AND_WITHDRAWAL](ACCOUNT_CLOSURE_AND_WITHDRAWAL.md)); independent production backup and restore |
| PDE-27 Adversarial acceptance | `full-debate-pilot.db.integration.mjs`, pilot, all suites | [INTEGRATION_TESTING](INTEGRATION_TESTING.md), [MULTI_CANDIDATE_PILOT](MULTI_CANDIDATE_PILOT.md) | concurrency/model-based suite for every plan §17 scenario |
| PDE-28 Accessibility and performance | axe [chromium-public] | [accessibility-test-plan](accessibility-test-plan.md), [BROWSER_ACCEPTANCE](BROWSER_ACCEPTANCE.md) | manual WCAG/media audit; Safari; load and budget tests ([OPERATIONS_AND_COST_CONTROLS](OPERATIONS_AND_COST_CONTROLS.md)) |
| PDE-29 Render/Neon deployment | "Live deployment smoke" workflow; `/api/health` reports the commit | [deployment-runbook](deployment-runbook.md), [FIRST_UPLOAD_DEPLOYMENT](FIRST_UPLOAD_DEPLOYMENT.md), [INFRASTRUCTURE](INFRASTRUCTURE.md) | hosted worker, notifications, monitors, rollback rehearsal |
| PDE-30 Release and handoff | `release-gates.test.mjs`, `npm run release:check` | [PRODUCTION_RELEASE_ACCEPTANCE](PRODUCTION_RELEASE_ACCEPTANCE.md), [ROADMAP_EVIDENCE](ROADMAP_EVIDENCE.md) | all gates accepted with evidence |
| PDE-31 Repository rename | `pr-registry.test.mjs` | [REPOSITORY_NAME_TRANSITION](REPOSITORY_NAME_TRANSITION.md) | owner decision on the optional slug rename |
| PDE-32 Product name and references | `pr-registry.test.mjs`, registry validation [validation] | [REPOSITORY_NAME_TRANSITION](REPOSITORY_NAME_TRANSITION.md) | hosted validation after transfer |
| PDE-33 Media selection | `modalities.test.ts` | [MULTIMODAL_ASSISTANT_PROTOCOL](MULTIMODAL_ASSISTANT_PROTOCOL.md) | — |
| PDE-34 Unified multimodal protocol | `multimodal.db.integration.mjs`, `modalities.test.ts` | [MULTIMODAL_DATA_MODEL](MULTIMODAL_DATA_MODEL.md) | — |
| PDE-35 Audio | `multimodal.db.integration.mjs`, `media.integration.mjs` | [MULTIMODAL_PUBLICATION](MULTIMODAL_PUBLICATION.md) | real audio playback on mobile |
| PDE-36 Written speeches and revisions | `corrections.db.integration.mjs` | [MULTIMODAL_PUBLICATION](MULTIMODAL_PUBLICATION.md) | — |
| PDE-37 Multimodal composer | pilot | [MEDIA_WORKROOM](MEDIA_WORKROOM.md) | manual accessibility of composer |
| PDE-38 Preliminary assistant | `private-assessment.test.ts`, `assistant-quality.test.ts` | [PRIVATE_ASSESSMENT](PRIVATE_ASSESSMENT.md), [PRIVATE_TRANSCRIPTION](PRIVATE_TRANSCRIPTION.md) | configured provider; false-positive audit |
| PDE-39 Suggestion review | `private-assessment.test.ts` | [PRIVATE_ASSESSMENT](PRIVATE_ASSESSMENT.md) | — |
| PDE-40 Final assessment | `private-assessment.test.ts` | [PRIVATE_ASSESSMENT](PRIVATE_ASSESSMENT.md) | — |
| PDE-41 Assessment privacy | `privacy.db.integration.mjs` | [ASSISTANT_PRIVACY_CONTROLS](ASSISTANT_PRIVACY_CONTROLS.md), [ASSESSMENT_ERASURE](ASSESSMENT_ERASURE.md), [ASSISTANT_CONSENT_REVOCATION](ASSISTANT_CONSENT_REVOCATION.md) | retention schedule review |
| PDE-42 Assistant evaluation | `assistant-quality.test.ts` | [ASSISTANT_EVALUATION](ASSISTANT_EVALUATION.md) | variation audit with a real provider |
| PDE-43 Interlocutor contract | `interlocutor.test.ts` | [INTERLOCUTOR_BRAND_INTEGRATION](INTERLOCUTOR_BRAND_INTEGRATION.md) | consuming application |
| PDE-44 End-to-end production acceptance | `release-gates.test.mjs`, all CI jobs | [PRODUCTION_RELEASE_ACCEPTANCE](PRODUCTION_RELEASE_ACCEPTANCE.md) | every production gate |

Recording new evidence: add a dated entry with reviewer and link to `registry/production-acceptance.json` and set the matching `operationalAcceptance` key in `registry/prs.json` only when the evidence exists.
