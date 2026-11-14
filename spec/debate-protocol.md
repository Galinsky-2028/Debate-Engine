# Public Debate Engine protocol (normative)

This is the normative protocol for the candidate-neutral engine. "MUST" rules are enforced in code unless marked *(planned)*. Requirements and their history are in [the development plan](../docs/DEVELOPMENT_PLAN.md) sections 2–7 and 10–11 and its October 11 expansion; state transitions are in [state-machine.md](state-machine.md); rights in [permission-and-consent-model.md](permission-and-consent-model.md); preservation in [archive-and-restriction-policy.md](archive-and-restriction-policy.md).

## 1. Two simultaneous views

1. **The complete public record** contains every published candidate contribution, its questions, answer references, assessments, objections, corrections and supporting documents. It MUST stay public whether or not the contribution qualifies.
2. **The qualifying debate sequence** contains only complete reciprocal exchanges (section 5). Being public never implies qualifying.

No candidate, including a debate's originator, can delete, hide, overwrite or de-index another candidate's published contribution. There is no ordinary delete endpoint for published contributions, and database triggers refuse UPDATE/DELETE of published rows (`0001_foundation.sql`, `0006`, `0007`).

## 2. Participants

- **Verified candidate**: a Neon Auth account whose candidacy for one office and election cycle has `verification_status='verified'`. Every candidate action is proven in SQL from the candidacy id *and* the authenticated subject; a client-supplied candidacy id alone is never trusted.
- **Same-office rule**: only candidacies in the debate's election cycle may contribute (`pde_guard_submission_actor`).
- **Platform administrator**: an Auth user id listed in `PLATFORM_ADMIN_USER_IDS`. Decides candidacy verification with a public procedural reason. Administration is not debate adjudication and grants no power over debate content.
- **Campaign delegates** (`editor`, `publisher`) can be granted and revoked by the candidacy owner. They cannot publish candidate speech, accept agreements or grant media rights in the current implementation.
- **The public** reads everything published without an account.

The engine never hard-codes a candidate, issue or race; offices and cycles are database content.

## 3. Opening a debate

A verified candidate publishes an opening that contains: a title, a plain-language proposition, one original contribution (video, audio or writing), **one to three** distinct questions with an anchor in that contribution (a timestamp, or `char:<offset>` for writing), the permitted media (any nonempty subset of video, audio, writing; video by default), the maximum response duration (1 s–2 h) and an optional reply window (1–720 h).

Publication MUST be a deliberate final confirmation of a private draft (`POST /api/private/drafts/{id}/confirm`) carrying the draft's SHA-256 fingerprint. Archive and qualifying-sequence permissions MUST be explicitly granted in the draft. Rules, questions and permitted media are immutable after publication; a later change requires mutual, prospective acceptance *(planned: [BRANCH_RULE_VERSIONS.md](../docs/BRANCH_RULE_VERSIONS.md))*.

## 4. Responding on independent branches

- Each other verified same-election candidate who answers the opening gets their own **branch** (`debate_branches`, one per debate and contender). Branches never share obligations, assessments, agreements or permissions; B never has to answer C.
- A contribution answers questions of the **immediately preceding** opponent contribution on the same branch (`pde_guard_answer_parent`), maps each answer to an anchor in its own content, and may ask new questions. Exactly one continuation per predecessor per branch (`one_continuing_reply_per_parent`).
- Media: the contribution must use a medium the debate permits; a different medium is refused before publication. No medium confers extra validity or time.
- **Format problems never hide speech.** An audio/video contribution longer than the maximum duration, a written one longer than its published word equivalent (150 words per minute of that duration), too many questions (more than three; ten is the hard archival limit), or a first response without a reciprocal question is still published, with `format_issues` recorded, and is footnoted out of the qualifying sequence (`packages/domain/modalities.ts`, `format.test.ts`).
- Universal technical limits (scanner verdict, 60 MiB original, accepted containers) apply equally to everyone and are disclosed.

## 5. Reciprocal exchange units

```
A0  originator's opening: asks Q1, Q2
B1  contender answers Q1, Q2; asks Q3, Q4
A2  originator answers Q3, Q4; may ask Q5…
```

The unit (B1, A2) **qualifies** when, and only when:

1. A (the questioner) has assessed each of Q1–Q2 on B1 as `answered`, and B1 references an answer to each;
2. A2 references an answer to each of Q3–Q4; and
3. B (the questioner) has assessed each of Q3–Q4 on A2 as `answered`;
4. neither B1 nor A2 has format issues.

The sequence is then A0, B1, A2, and A2's new questions open the next unit; they never reopen a completed one. Evaluation stops at the first non-qualifying unit; later contributions stay public. Rules: `packages/domain/debate.ts` (`qualifyExchange`) and `packages/domain/sequence.ts` (`branchSequence`); tests `protocol.test.ts`, `sequence.test.ts`, `full-debate-pilot.db.integration.mjs`.

Distinct, honestly labelled outcomes:

| Outcome | Meaning | Who owes the next action |
| --- | --- | --- |
| `awaiting_originator_assessment` | A has not assessed B's answers. *Unreviewed is not unanswered.* | A |
| `footnoted` | A assessed a question as not answered (or B gave no reference). Shown with A's attributed reason and B's objections. | — |
| `footnoted_format` | A format issue on B1 or A2. | — |
| `awaiting_originator_answer` | A has not published a reciprocal answer. B1 is public and labelled as awaiting A. | A |
| `awaiting_responder_assessment` | B has not assessed A's answers. | B |
| `reciprocity_disputed` | B assessed A's answer as not answered. Both contributions remain public. | — |
| `qualified` | All four conditions hold. | — |

Only the questioner may assess their own question, only on the immediately following opponent contribution (`pde_guard_assessment`). Allowed judgments: `answered`, `partly_answered`, `not_answered`, `disputed_premise`, each with a reason; only `answered` satisfies reciprocity. A reversal is a new assessment that supersedes the previous one; the latest one counts and the history stays public. The assessed candidate may file public objections (with an optional timestamp). Assessments are attributed participant judgments, never a platform verdict. No AI, moderator or administrator overwrites them.

The qualifying sequence is currently computed on read from the immutable record (`GET /api/debates/{id}/sequence`). Persisted, versioned sequence manifests, whose earlier versions stay inspectable, are *(planned: [BRANCH_RULE_VERSIONS.md](../docs/BRANCH_RULE_VERSIONS.md))*.

## 6. Time

- All instants are server UTC; the browser clock is never authoritative.
- A published continuation that asks questions opens a **reply** obligation for the opponent; one that answers questions opens a **review** obligation for the questioner. Both use the debate's reply window and open at publication time, never when the other side gets around to reviewing.
- A reply is timely if it is **received** by the effective due time; later platform processing never makes it late (`deadlines.test.ts`).
- Documented outage adjustments extend the effective due time additively and visibly (`obligation_outage_adjustments`). Creating them through an authorized operator flow is *(planned: [BRANCH_RULE_VERSIONS.md](../docs/BRANCH_RULE_VERSIONS.md))*.
- An invitation that was never sent does not start a clock (`invitedReplyOpenedAt`). Invitations themselves are *(planned: [INVITATIONS.md](../docs/INVITATIONS.md))*.
- Labels are neutral: open, overdue, fulfilled on time, fulfilled late. A timeout never implies concession, defeat or victory. Late replies stay publishable and resume the exchange with lateness recorded.

## 7. Corrections

An author may append a permanent, attributed correction or retraction (20–5,000 characters) to their own published contribution (`submission_corrections`). It never replaces the original, its questions, answers, assessments or sequence position. Supporting documents (PDF, DOCX, plain text, up to 20 MiB) may be appended by the author and are versioned, never rewritten.

## 8. Resolution

- Either branch participant may propose a policy version (20–50,000 characters), optionally as a child of an earlier version. Its SHA-256 digest covers the normalized body and attachments.
- Acceptance MUST name the exact version id and digest. A **joint agreement** exists while both participants' latest endorsement event for the *same* version is `accept`. A different version never inherits acceptance.
- A participant may withdraw current support. Withdrawal is a new public event; the historical acceptance is kept (`policy_endorsement_events`, `policy-endorsement.db.integration.mjs`).
- Agreement on one branch never affects another branch.
- Scoped **partial agreements** that leave named questions unresolved are *(planned; tracked under PDE-19)*.
- The engine reports agreement; it never certifies that a policy is objectively best.

## 9. Summaries and derivative media

Derivative media (concise master, 5 min, 3 min, 60 s, 30 s) are built from an editorial manifest of exact source clips. Rendering requires a clip-scoped edit permission from **every** source owner; release requires both participants' approval of the exact rendered SHA-256 and a jointly accepted policy. Withholding approval never affects the policy agreement or the original record. Details: [permission-and-consent-model.md](permission-and-consent-model.md). External dissemination is *(planned: [DISSEMINATION_AND_NOTIFICATIONS.md](../docs/DISSEMINATION_AND_NOTIFICATIONS.md))*.

## 10. Private Debate Assistant

Optional, private, opt-in analysis of the author's own draft (preliminary) and of exactly the published text (final). It needs explicit provider consent and a configured provider; with none configured it reports "unavailable" and never invents findings. Its output never affects assessments, qualification, scores or any public surface. See [PRIVATE_ASSESSMENT.md](../docs/PRIVATE_ASSESSMENT.md).

## 11. Governance boundaries

The originator's power to assess their own questions never includes deleting others' records, impersonating approvals, operating platform restrictions or editing others' media. Exceptional restrictions for security, safety or legal reasons belong to an independent, auditable process: [archive-and-restriction-policy.md](archive-and-restriction-policy.md).

## 12. Explicitly unresolved

The user's sentence beginning "When a candidate uploads a video, whether the original video or" was never completed. It remains an open requirement. No rule has been inferred from it, and none may be implemented without the owner completing it.
