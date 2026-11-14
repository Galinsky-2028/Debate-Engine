import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {projectObligation, obligationStateLabel, invitationResponseClock, OBLIGATION_STATE_LABELS} from "../packages/domain/deadlines.ts";
import {projectInvitation} from "../packages/domain/invitations.ts";
import {missingDistributePermissionMessage} from "../lib/server/distribute-permissions.ts";

test("a superseded obligation is never overdue, even long after its due time", () => {
  const result = projectObligation({id: "s", openedAt: "2026-10-10T10:00:00Z", dueAt: "2026-10-10T11:00:00Z", supersededAt: "2026-10-10T10:30:00Z"}, "2026-10-20T00:00:00Z");
  assert.equal(result.state, "superseded_by_agreement");
  assert.equal(result.supersededAt, "2026-10-10T10:30:00.000Z");
  assert.equal(obligationStateLabel(result.state), "Closed by the candidates' recorded agreement");
  // Superseded after the deadline passed (agreement reached late) is still closed, not overdue.
  assert.equal(projectObligation({id: "s2", openedAt: "2026-10-10T10:00:00Z", dueAt: "2026-10-10T11:00:00Z", supersededAt: "2026-10-12T10:00:00Z"}, "2026-10-13T00:00:00Z").state, "superseded_by_agreement");
});

test("a received obligation cannot also be superseded, and supersession cannot precede opening", () => {
  assert.throws(() => projectObligation({id: "x", openedAt: "2026-10-10T10:00:00Z", dueAt: null, receivedAt: "2026-10-10T10:10:00Z", supersededAt: "2026-10-10T10:20:00Z"}, "2026-10-11T00:00:00Z"));
  assert.throws(() => projectObligation({id: "y", openedAt: "2026-10-10T10:00:00Z", dueAt: null, supersededAt: "2026-10-09T10:00:00Z"}, "2026-10-11T00:00:00Z"));
  assert.equal(projectObligation({id: "z", openedAt: "2026-10-10T10:00:00Z", dueAt: "2026-10-10T11:00:00Z"}, "2026-10-11T00:00:00Z").supersededAt, null);
});

test("every state has neutral wording, with no concession language", () => {
  for (const label of Object.values(OBLIGATION_STATE_LABELS)) assert.doesNotMatch(label, /conced|forfeit|refus|ignor|fail/i);
  assert.equal(obligationStateLabel("unknown_state"), "unknown_state");
});

test("an invitation response clock needs provider evidence and a reply window", () => {
  assert.equal(invitationResponseClock("2026-10-10T10:00:00Z", null, 72), null);
  assert.equal(invitationResponseClock("2026-10-10T10:00:00Z", "2026-10-10T11:00:00Z", null), null);
  assert.deepEqual(invitationResponseClock("2026-10-10T10:00:00Z", "2026-10-10T11:00:00Z", 72), {openedAt: "2026-10-10T11:00:00.000Z", dueAt: "2026-10-13T11:00:00.000Z"});
  // Evidence before publication (queued draft accepted early) still starts at publication.
  assert.equal(invitationResponseClock("2026-10-10T10:00:00Z", "2026-10-10T09:00:00Z", 1)!.openedAt, "2026-10-10T10:00:00.000Z");
  assert.throws(() => invitationResponseClock("2026-10-10T10:00:00Z", "2026-10-10T11:00:00Z", 0));
  assert.throws(() => invitationResponseClock("2026-10-10T10:00:00Z", "2026-10-10T11:00:00Z", 1.5));
});

test("the invitation projection uses the durable clock (including outage extensions) and labels timing neutrally", () => {
  const base = {debatePublishedAt: "2026-10-10T10:00:00Z", providerEvidenceAt: "2026-10-10T11:00:00Z", replyWindowHours: 24};
  const clock = {openedAt: "2026-10-10T11:00:00Z", effectiveDueAt: "2026-10-11T13:00:00Z"};
  const open = projectInvitation({...base, respondedAt: null, now: "2026-10-11T12:00:00Z", clock});
  assert.equal(open.state, "sent", "an outage extension keeps the invitation open past the nominal window");
  assert.equal(open.responseDueAt, "2026-10-11T13:00:00.000Z");
  assert.match(projectInvitation({...base, respondedAt: "2026-10-11T12:30:00Z", now: "2026-10-12T00:00:00Z", clock}).label, /\(within the response window\)$/);
  assert.match(projectInvitation({...base, respondedAt: "2026-10-11T14:00:00Z", now: "2026-10-12T00:00:00Z", clock}).label, /\(after the response window\)$/);
  assert.equal(projectInvitation({...base, respondedAt: null, now: "2026-10-11T14:00:00Z", clock}).state, "no_response");
  // Without a durable clock the earlier display-only computation still applies and adds no timing claim.
  assert.equal(projectInvitation({...base, respondedAt: "2026-10-12T00:00:00Z", now: "2026-10-12T00:00:00Z"}).label, "Response received 2026-10-12 00:00 UTC");
});

test("missing distribution permission names each owner and distinguishes withdrawn from never granted", () => {
  assert.equal(missingDistributePermissionMessage([
    {mediaAssetId: "m1", ownerCandidacyId: "a", ownerName: "Fictional A", state: "current"},
    {mediaAssetId: "m2", ownerCandidacyId: "b", ownerName: "Fictional B", state: "current"},
  ]), null);
  const message = missingDistributePermissionMessage([
    {mediaAssetId: "m1", ownerCandidacyId: "a", ownerName: "Fictional A", state: "withdrawn"},
    {mediaAssetId: "m2", ownerCandidacyId: "b", ownerName: "Fictional B", state: "missing"},
    {mediaAssetId: "m3", ownerCandidacyId: "b", ownerName: "Fictional B", state: "withdrawn"},
  ])!;
  assert.match(message, /Fictional A withdrew distribution permission/);
  assert.match(message, /Fictional B has not granted distribution permission/);
  assert.doesNotMatch(message, /Fictional B withdrew/);
  assert.match(missingDistributePermissionMessage([])!, /no source videos/);
});

test("wiring: endorsement supersedes in the same transaction; the worker and notices skip superseded clocks", () => {
  const convergence = readFileSync("lib/server/policy-convergence.ts", "utf8");
  assert.match(convergence, /jointlyAgreed&&scope==="full"[\s\S]*pde_supersede_obligations_by_agreement/);
  const worker = readFileSync("scripts/deadline-worker.mjs", "utf8");
  assert.match(worker, /if \(current\.superseded_at\)[\s\S]*state='completed'/);
  const outbox = readFileSync("packages/delivery/outbox-store.ts", "utf8");
  assert.match(outbox, /o\.received_at \|\| o\.superseded/);
  for (const file of ["lib/server/public-debates.ts", "app/workspace/obligation-inbox.tsx"])
    assert.match(readFileSync(file, "utf8"), /superseded_by_agreement/);
});
