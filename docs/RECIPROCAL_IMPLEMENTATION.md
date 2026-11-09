# The reciprocal public-debate implementation

The API distinguishes **public contribution** from **qualified unedited sequence**.

1. Only verified candidates for the same election may publish; all published media are retained without ordinary deletion.
2. Initial opponent response requires at least one reciprocal question, which the originator must answer before the exchange can qualify.
3. A candidate publishes a new contribution as a child of their opponent's most recent contribution, maintaining independent branch continuity and symmetric video duration rules.
4. The candidate who asked a question publishes attributed assessments of the following opponent video. Changes are new immutable, superseding records, not edits. The respondent can object.
5. The deterministic sequence projection reads the entire published record and emits only completed reciprocal exchanges. Disputes and pending replies do not suppress any video.
6. A published but late contribution remains public. Reply-window notification/reminder and policy for deadline consequences still require separate agreement.
7. Completed qualifying exchanges are stored in immutable, append-only sequence manifests. Later assessments remain public without removing previously published exchanges. See [sequence history](QUALIFYING_SEQUENCE_UI.md).
8. Both participants may approve exact-version future branch rules. Old publications and old deadlines remain unchanged. Stale drafts require renewed review. See [branch rule versions](BRANCH_RULE_VERSIONS.md).

The response composer supports up to three reciprocal questions, or none for a closing reply. The browser pilot exercises two questions, both assessments, publication recovery, immutable history and future rule changes. Local writing workflows do not establish hosted media scanning, storage, live sign-in, notification delivery or production acceptance.
