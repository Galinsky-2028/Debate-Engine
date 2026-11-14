import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {manifestSeconds, parseBudget, renderBudgetDecision, storageBudgetDecision} from "../packages/domain/budget.ts";

test("unset budgets are reported as unconfigured; invalid budgets fail closed", () => {
  assert.equal(parseBudget(undefined), null);
  assert.equal(parseBudget(""), null);
  assert.equal(parseBudget("1000"), 1000);
  assert.equal(parseBudget("-5"), 0);
  assert.equal(parseBudget("ten"), 0);
  assert.equal(parseBudget("1.5"), 0);
  const open = storageBudgetDecision({budgetBytes: null, storedBytes: 10 ** 12, reservedBytes: 0, requestedBytes: 10 ** 9});
  assert.deepEqual([open.allowed, open.configured], [true, false]);
});

test("storage budget counts stored originals plus active reservations", () => {
  const ok = storageBudgetDecision({budgetBytes: 1000, storedBytes: 600, reservedBytes: 200, requestedBytes: 200});
  assert.equal(ok.allowed, true);
  assert.equal(ok.remaining, 200);
  const over = storageBudgetDecision({budgetBytes: 1000, storedBytes: 600, reservedBytes: 200, requestedBytes: 201});
  assert.equal(over.allowed, false);
  assert.match(over.message!, /paused/);
  assert.match(over.message!, /no stored original is deleted/);
  const exhausted = storageBudgetDecision({budgetBytes: 1000, storedBytes: 1000, reservedBytes: 0, requestedBytes: 0});
  assert.equal(exhausted.allowed, false, "capability check reports exhaustion");
  assert.equal(exhausted.remaining, 0);
  const zero = storageBudgetDecision({budgetBytes: 0, storedBytes: 0, reservedBytes: 0, requestedBytes: 1});
  assert.equal(zero.allowed, false);
  assert.throws(() => storageBudgetDecision({budgetBytes: 1, storedBytes: -1, reservedBytes: 0, requestedBytes: 0}));
});

test("render budget pauses optional renders without touching published work", () => {
  assert.equal(renderBudgetDecision({budgetSecondsPerDay: 600, usedSecondsToday: 500, requestedSeconds: 100}).allowed, true);
  const paused = renderBudgetDecision({budgetSecondsPerDay: 600, usedSecondsToday: 500, requestedSeconds: 101});
  assert.equal(paused.allowed, false);
  assert.match(paused.message!, /Published originals and released summaries are unaffected/);
  assert.equal(renderBudgetDecision({budgetSecondsPerDay: null, usedSecondsToday: 10 ** 6, requestedSeconds: 10}).allowed, true);
});

test("manifest seconds sum clip ranges and reject inverted clips", () => {
  assert.equal(manifestSeconds([{startSeconds: 1, endSeconds: 11}, {startSeconds: 20, endSeconds: 25.5}]), 15.5);
  assert.throws(() => manifestSeconds([{startSeconds: 5, endSeconds: 1}]));
});

test("budget checks are applied before new uploads and renders; nothing deletes stored media", () => {
  const sessions = readFileSync("lib/server/resumable-uploads.ts", "utf8");
  const upload = readFileSync("app/api/media/upload/route.ts", "utf8");
  const render = readFileSync("lib/server/summary-approval.ts", "utf8");
  const budget = readFileSync("lib/server/budget.ts", "utf8");
  const caps = readFileSync("app/api/capabilities/route.ts", "utf8");
  assert.match(sessions, /await requireStorageBudget\(input\.sizeBytes\)/);
  assert.ok(sessions.indexOf("requireStorageBudget(input.sizeBytes)") < sessions.indexOf("CreateMultipartUploadCommand({"));
  assert.match(upload, /await requireStorageBudget\(file\.size\)/);
  assert.ok(upload.indexOf("requireStorageBudget(file.size)") < upload.indexOf("storeOriginal(key"));
  assert.match(render, /await requireRenderBudget\(db,manifestSeconds\(clips\),input\.artifactId\)/);
  assert.match(caps, /mediaStorageBudget/);
  assert.match(caps, /optionalRendering/);
  assert.doesNotMatch(budget, /DELETE|DeleteObject/);
});
