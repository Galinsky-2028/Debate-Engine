import test from "node:test";
import assert from "node:assert/strict";
import {randomUUID, randomBytes} from "node:crypto";
import {createServer} from "node:http";
import pg from "pg";
import {
  processOutbox, defaultAdapters, enqueueAction, enqueueObligationNotifications, enqueueInvitationDelivery, retryDeadLetter,
} from "../packages/delivery/outbox-store.ts";
import {runWebhookChallenge} from "../packages/delivery/webhook.ts";
import {loadInvitationProjections} from "../packages/delivery/invitations-store.ts";
import {verifyWebhookSignature} from "../packages/domain/outbox.ts";
import {runDeadlineJobs} from "../scripts/deadline-worker.mjs";

if (!process.env.DATABASE_URL) throw Error("A disposable PostgreSQL DATABASE_URL is required.");
// Outbox processing uses separate pooled connections, so fixtures are committed with unique, explicitly fictional data.
const pool = new pg.Pool({connectionString: process.env.DATABASE_URL, max: 6});
const testEnv = {NODE_ENV: "test", PDE_ALLOW_LOOPBACK_WEBHOOKS: "true"};
const q = (sql, args) => pool.query(sql, args);
const one = async (sql, args) => (await q(sql, args)).rows[0];

/** Local destination server: records signed deliveries; paths choose behavior. */
async function destinationServer() {
  const received = [];
  let failuresLeft = 0;
  const server = createServer((req, res) => {
    let body = "";
    req.on("data", c => { body += c; });
    req.on("end", () => {
      const event = {path: req.url, headers: req.headers, body};
      received.push(event);
      if (req.url === "/echo") { res.writeHead(200, {"content-type": "application/json"}); res.end(JSON.stringify({challenge: JSON.parse(body).data.challenge})); return; }
      if (req.url === "/no-echo") { res.writeHead(200); res.end("ok"); return; }
      if (req.url === "/flaky" && failuresLeft-- > 0) { res.writeHead(503); res.end("busy"); return; }
      if (req.url === "/down") { res.writeHead(500); res.end("down"); return; }
      if (req.url === "/redirect") { res.writeHead(302, {location: "http://169.254.169.254/"}); res.end(); return; }
      if (req.url === "/email") { res.writeHead(202, {"content-type": "application/json"}); res.end(JSON.stringify({id: "provider-" + received.length})); return; }
      res.writeHead(200); res.end("ok");
    });
  });
  await new Promise(r => server.listen(0, "127.0.0.1", r));
  const base = `http://127.0.0.1:${server.address().port}`;
  return {server, base, received, setFailures(n) { failuresLeft = n; }};
}

async function fixture() {
  const office = (await one("INSERT INTO offices(slug,title,jurisdiction) VALUES($1,'Fictional outbox office','Fictional') RETURNING id", ["outbox-" + randomUUID()])).id;
  const election = (await one("INSERT INTO election_cycles(office_id,election_date,label) VALUES($1,'2032-11-02','Fictional outbox election') RETURNING id", [office])).id;
  const other = (await one("INSERT INTO election_cycles(office_id,election_date,label) VALUES($1,'2034-11-02','Other fictional election') RETURNING id", [office])).id;
  const actor = async (label, electionId = election, status = "verified") => {
    const account = (await one("INSERT INTO accounts(identity_provider,external_subject,display_name) VALUES('fixture',$1,$2) RETURNING id", [randomUUID(), label])).id;
    const candidacy = (await one("INSERT INTO candidacies(account_id,election_id,public_name,verification_status) VALUES($1,$2,$3,$4) RETURNING id", [account, electionId, label, status])).id;
    return {account, candidacy};
  };
  const a = await actor("Fixture Candidate A"), b = await actor("Fixture Candidate B"), c = await actor("Fixture Candidate C");
  const unverified = await actor("Fixture Unverified", election, "pending"), elsewhere = await actor("Fixture Elsewhere", other);
  const debate = (await one("INSERT INTO debates(election_id,originator_candidacy_id,title,proposition,max_response_seconds,reply_window_hours,allowed_modalities) VALUES($1,$2,'Fictional outbox debate','A fictional proposition for delivery tests',300,72,ARRAY['writing']::text[]) RETURNING id", [election, a.candidacy])).id;
  const opening = (await one("INSERT INTO submissions(debate_id,candidacy_id,kind,modality,written_content) VALUES($1,$2,'opening','writing','Fictional opening statement for outbox delivery tests.') RETURNING id", [debate, a.candidacy])).id;
  await q("UPDATE submissions SET published_at=now() WHERE id=$1", [opening]);
  await q("UPDATE debates SET status='published',published_at=now() WHERE id=$1", [debate]);
  const branch = (await one("INSERT INTO debate_branches(debate_id,responder_candidacy_id) VALUES($1,$2) RETURNING id", [debate, b.candidacy])).id;
  const reply = (await one("INSERT INTO submissions(debate_id,branch_id,candidacy_id,parent_submission_id,kind,modality,written_content) VALUES($1,$2,$3,$4,'response','writing','Fictional reply statement for outbox delivery tests.') RETURNING id", [debate, branch, b.candidacy, opening])).id;
  await q("UPDATE submissions SET published_at=now() WHERE id=$1", [reply]);
  return {a, b, c, unverified, elsewhere, debate, branch, reply};
}

async function destination(owner, kind, address, purposes = ["notifications", "distribution"], verified = true) {
  const secret = kind === "webhook" ? randomBytes(32).toString("base64url") : null;
  const row = await one("INSERT INTO delivery_destinations(candidacy_id,created_by_account_id,kind,purposes,label,address,signing_secret) VALUES($1,$2,$3,$4::text[],$5,$6,$7) RETURNING id",
    [owner.candidacy, owner.account, kind, purposes, "Fixture " + kind, address, secret]);
  if (verified) await q("UPDATE delivery_destinations SET verified_at=now() WHERE id=$1", [row.id]);
  return {id: row.id, secret};
}
const action = id => one("SELECT * FROM outgoing_actions WHERE id=$1", [id]);
const payload = (subject = "Fixture notice") => ({type: "pde.test", data: {fixture: true}, email: {subject, text: "Fictional test body"}});
async function drain(adapters, rounds = 1) { for (let i = 0; i < rounds; i++) await processOutbox(pool, {limit: 50, adapters}); }
async function makeDue(ids) { await q("UPDATE outgoing_actions SET next_attempt_at=now() WHERE id=ANY($1::uuid[]) AND state IN ('pending','failed')", [ids]); }

test.before(async () => {
  // Retire leftovers from earlier runs of this disposable database so batches only see this run's work.
  await q("UPDATE outgoing_actions SET state='dead',dead_at=now(),last_error='retired by test setup' WHERE state IN ('pending','failed')");
});
test.after(async () => { await pool.end(); });

test("webhook verification: the endpoint must echo a signed challenge", async () => {
  const s = await destinationServer();
  try {
    const secret = randomBytes(32).toString("base64url");
    const ok = await runWebhookChallenge({url: s.base + "/echo", secret, challenge: "chal-" + randomUUID(), eventId: randomUUID(), allowLoopback: true});
    assert.deepEqual(ok, {ok: true, detail: ""});
    const sent = s.received.at(-1);
    assert.equal(verifyWebhookSignature({secret, signature: sent.headers["x-pde-signature"], timestamp: sent.headers["x-pde-timestamp"], eventId: sent.headers["x-pde-event-id"], body: sent.body, nowSeconds: Math.floor(Date.now() / 1000)}), true);
    assert.equal((await runWebhookChallenge({url: s.base + "/no-echo", secret, challenge: "x", eventId: randomUUID(), allowLoopback: true})).ok, false);
    const refused = await runWebhookChallenge({url: s.base + "/echo", secret, challenge: "x", eventId: randomUUID(), allowLoopback: false});
    assert.equal(refused.ok, false, "loopback is refused unless explicitly allowed for tests");
  } finally { s.server.close(); }
});

test("destination rules: owner-only, max 10 active, immutable addresses, unverified cannot receive", async () => {
  const f = await fixture();
  await assert.rejects(q("INSERT INTO delivery_destinations(candidacy_id,created_by_account_id,kind,purposes,label,address) VALUES($1,$2,'email',ARRAY['notifications'],'x','x@example.org')", [f.a.candidacy, f.b.account]), /verified candidacy owner/);
  await assert.rejects(q("INSERT INTO delivery_destinations(candidacy_id,created_by_account_id,kind,purposes,label,address) VALUES($1,$2,'email',ARRAY['notifications'],'x','a@example.org,b@example.org')", [f.a.candidacy, f.a.account]));
  const dests = [];
  for (let i = 0; i < 10; i++) dests.push(await destination(f.c, "email", `fixture${i}-${randomUUID().slice(0, 8)}@example.org`, ["notifications"], false));
  await assert.rejects(destination(f.c, "email", "eleven@example.org", ["notifications"], false), /at most 10/);
  await q("UPDATE delivery_destinations SET disabled_at=now() WHERE id=$1", [dests[0].id]);
  await destination(f.c, "email", "replacement@example.org", ["notifications"], false);
  await assert.rejects(q("UPDATE delivery_destinations SET disabled_at=NULL WHERE id=$1", [dests[0].id]), /cannot be re-enabled/);
  await assert.rejects(q("UPDATE delivery_destinations SET address='other@example.org' WHERE id=$1", [dests[1].id]), /immutable/);
  await assert.rejects(q("DELETE FROM delivery_destinations WHERE id=$1", [dests[1].id]), /never deleted/);
  await assert.rejects(enqueueAction(pool, {actionType: "notification", destinationId: dests[1].id, ownerCandidacyId: f.c.candidacy, dedupeKey: "x", payload: payload(), subjectKind: "obligation", subjectId: randomUUID()}), /not verified/);
  const notifyOnly = await destination(f.b, "email", "notify-only@example.org", ["notifications"]);
  await assert.rejects(enqueueAction(pool, {actionType: "distribution", destinationId: notifyOnly.id, ownerCandidacyId: f.b.candidacy, dedupeKey: "x", payload: payload(), subjectKind: "policy_version", subjectId: randomUUID()}), /not authorized for distribution/);
  await assert.rejects(enqueueAction(pool, {actionType: "notification", destinationId: notifyOnly.id, ownerCandidacyId: f.a.candidacy, dedupeKey: "x", payload: payload(), subjectKind: "obligation", subjectId: randomUUID()}), /must own/);
});

test("delivery, partial failure retried without duplicating the success, dead letter, idempotent enqueue", async () => {
  const s = await destinationServer();
  try {
    const f = await fixture();
    const good = await destination(f.a, "webhook", s.base + "/ok");
    const flaky = await destination(f.a, "webhook", s.base + "/flaky");
    const down = await destination(f.a, "webhook", s.base + "/down");
    const redirect = await destination(f.a, "webhook", s.base + "/redirect");
    const adapters = defaultAdapters(testEnv);
    const key = "fixture-distribution-" + randomUUID();
    const ids = {};
    for (const [name, d] of Object.entries({good, flaky, down, redirect})) {
      const r = await enqueueAction(pool, {actionType: "distribution", destinationId: d.id, ownerCandidacyId: f.a.candidacy, dedupeKey: key, payload: payload(), branchId: f.branch, debateId: f.debate, subjectKind: "policy_version", subjectId: randomUUID()});
      assert.equal(r.created, true); ids[name] = r.id;
      const again = await enqueueAction(pool, {actionType: "distribution", destinationId: d.id, ownerCandidacyId: f.a.candidacy, dedupeKey: key, payload: payload(), branchId: f.branch, debateId: f.debate, subjectKind: "policy_version", subjectId: randomUUID()});
      assert.equal(again.created, false, "duplicate enqueue is a no-op");
    }
    assert.equal((await one("SELECT count(*)::int AS n FROM outgoing_actions WHERE dedupe_key=$1", [key])).n, 4);
    s.setFailures(2);
    await drain(adapters);
    let good1 = await action(ids.good);
    assert.equal(good1.state, "delivered");
    assert.ok(good1.delivered_at && good1.accepted_at);
    const delivery = s.received.find(e => e.path === "/ok");
    assert.equal(delivery.headers["x-pde-event-id"], ids.good);
    assert.equal(verifyWebhookSignature({secret: good.secret, signature: delivery.headers["x-pde-signature"], timestamp: delivery.headers["x-pde-timestamp"], eventId: ids.good, body: delivery.body, nowSeconds: Math.floor(Date.now() / 1000)}), true);
    assert.equal(JSON.parse(delivery.body).id, ids.good);
    assert.equal((await action(ids.flaky)).state, "failed");
    assert.match((await action(ids.flaky)).last_error, /HTTP 503/);
    const red = await action(ids.redirect);
    assert.equal(red.state, "dead", "redirects are refused, never followed");
    assert.match(red.last_error, /redirect/i);
    for (let round = 0; round < 3; round++) { await makeDue([ids.flaky, ids.down]); await drain(adapters); }
    assert.equal((await action(ids.flaky)).state, "delivered", "the failed destination recovers on retry");
    assert.equal(s.received.filter(e => e.path === "/ok").length, 1, "the successful destination was never re-sent");
    assert.equal(s.received.filter(e => e.path === "/redirect").length, 1);
    good1 = await action(ids.good);
    assert.equal(good1.attempts, 1);
    await assert.rejects(q("UPDATE outgoing_actions SET state='pending' WHERE id=$1", [ids.good]), /Illegal outbox transition/);
    await assert.rejects(q("DELETE FROM outgoing_actions WHERE id=$1", [ids.good]), /retained/);
    // Exhaust the always-down destination.
    for (let round = 0; round < 10; round++) { await makeDue([ids.down]); await drain(adapters); }
    const dead = await action(ids.down);
    assert.equal(dead.state, "dead");
    assert.equal(dead.attempts, dead.max_attempts);
    assert.match(dead.last_error, /HTTP 500/);
    assert.equal(dead.accepted_at, null);
    assert.equal(await retryDeadLetter(pool, ids.good), false, "delivered actions cannot be retried");
    assert.equal(await retryDeadLetter(pool, ids.down), true);
    const requeued = await action(ids.down);
    assert.equal(requeued.state, "pending");
    assert.equal(requeued.max_attempts, dead.attempts + 3);
    const accepted = await one("SELECT count(DISTINCT destination_id)::int AS n FROM outgoing_actions WHERE action_type='distribution' AND branch_id=$1 AND state IN ('accepted','delivered')", [f.branch]);
    assert.equal(accepted.n, 2, "public distribution counts only use delivered/accepted evidence");
  } finally { s.server.close(); }
});

test("email: an unconfigured provider never marks anything sent; a configured provider is acceptance, not delivery", async () => {
  const s = await destinationServer();
  try {
    const f = await fixture();
    const mailbox = await destination(f.b, "email", `fixture-${randomUUID().slice(0, 8)}@example.org`);
    const r = await enqueueAction(pool, {actionType: "notification", destinationId: mailbox.id, ownerCandidacyId: f.b.candidacy, dedupeKey: "fixture-email-" + randomUUID(), payload: payload("Response due\r\nBcc: victim@example.org"), subjectKind: "obligation", subjectId: randomUUID()});
    for (let round = 0; round < 3; round++) { await makeDue([r.id]); await drain(defaultAdapters(testEnv)); }
    let row = await action(r.id);
    assert.equal(row.state, "pending");
    assert.equal(row.last_error, "provider_unconfigured");
    assert.equal(row.attempts, 0);
    assert.equal(row.accepted_at, null);
    assert.equal(row.provider_receipt, null);
    await makeDue([r.id]);
    await drain(defaultAdapters({...testEnv, EMAIL_API_URL: s.base + "/email", EMAIL_API_KEY: "fixture-key", EMAIL_FROM: "notices@example.org"}));
    row = await action(r.id);
    assert.equal(row.state, "accepted");
    assert.equal(row.delivered_at, null, "provider acceptance is not delivery");
    assert.match(row.provider_receipt, /^provider-/);
    const sent = JSON.parse(s.received.find(e => e.path === "/email").body);
    assert.equal(sent.to, (await one("SELECT address FROM delivery_destinations WHERE id=$1", [mailbox.id])).address);
    assert.equal(/[\r\n]/.test(sent.subject), false);
    assert.equal(s.received.find(e => e.path === "/email").headers.authorization, "Bearer fixture-key");
  } finally { s.server.close(); }
});

test("notifications: contribution-opened, due-soon and overdue notices are queued once even when jobs run twice", async () => {
  const f = await fixture();
  const n1 = await destination(f.a, "email", `notices-${randomUUID().slice(0, 8)}@example.org`, ["notifications"]);
  await destination(f.a, "email", `distribution-only-${randomUUID().slice(0, 8)}@example.org`, ["distribution"]);
  const n2 = await destination(f.a, "email", `second-${randomUUID().slice(0, 8)}@example.org`, ["notifications"]);
  const overdue = (await one("INSERT INTO reply_obligations(debate_id,branch_id,source_submission_id,obligated_candidacy_id,obligation_type,opened_at,due_at) VALUES($1,$2,$3,$4,'reply',now()-interval '4 days',now()-interval '1 hour') RETURNING id", [f.debate, f.branch, f.reply, f.a.candidacy])).id;
  const soon = (await one("INSERT INTO reply_obligations(debate_id,branch_id,source_submission_id,obligated_candidacy_id,obligation_type,opened_at,due_at) VALUES($1,$2,$3,$4,'review',now()-interval '3 days',now()+interval '12 hours') RETURNING id", [f.debate, f.branch, f.reply, f.a.candidacy])).id;
  assert.equal(await enqueueObligationNotifications(pool, {obligationId: soon, phase: "opened"}), 2, "one per verified notification destination");
  assert.equal(await enqueueObligationNotifications(pool, {obligationId: soon, phase: "opened"}), 0, "re-running is a no-op");
  for (const id of [overdue, soon])
    await q("INSERT INTO durable_jobs(job_type,dedupe_key,arguments,available_at) VALUES('obligation_deadline',$1,$2::jsonb,now()-interval '1 minute')", ["fixture:" + id, JSON.stringify({obligationId: id})]);
  // Two concurrent workers plus a "restart" re-run.
  await Promise.all([runDeadlineJobs(pool, 50), runDeadlineJobs(pool, 50)]);
  await q("UPDATE durable_jobs SET state='queued',available_at=now(),leased_until=NULL WHERE dedupe_key=$1", ["fixture:" + overdue]);
  await runDeadlineJobs(pool, 50);
  const rows = (await q("SELECT dedupe_key,destination_id,payload FROM outgoing_actions WHERE subject_kind='obligation' AND subject_id=ANY($1::uuid[]) ORDER BY dedupe_key", [[overdue, soon]])).rows;
  const keys = rows.map(r => r.dedupe_key.split(":")[2]);
  assert.equal(keys.filter(k => k === "overdue").length, 2, "one overdue notice per destination, never duplicated");
  assert.equal(keys.filter(k => k === "due_soon").length, 2);
  assert.equal(keys.filter(k => k === "opened").length, 2);
  assert.ok(rows.every(r => [n1.id, n2.id].includes(r.destination_id)), "distribution-only destinations get no notices");
  assert.equal((await one("SELECT count(*)::int AS n FROM publication_events WHERE kind='obligation_overdue' AND object_id=$1", [overdue])).n, 1);
  for (const r of rows) {
    assert.doesNotMatch(JSON.stringify(r.payload), /conced|defeat|forfeit/i);
    assert.doesNotMatch(JSON.stringify(r.payload), /@example\.org/, "payloads carry no private addresses");
  }
  assert.match(rows.find(r => r.dedupe_key.includes(":overdue:")).payload.email.subject, /^No response received by /);
  const soonJob = await one("SELECT state,available_at FROM durable_jobs WHERE dedupe_key=$1", ["fixture:" + soon]);
  assert.equal(soonJob.state, "queued");
  assert.ok(new Date(soonJob.available_at) > new Date(), "the job is rescheduled for the deadline itself");
  // A fulfilled obligation gets no further notices.
  await q("UPDATE reply_obligations SET received_at=now() WHERE id=$1", [soon]);
  assert.equal(await enqueueObligationNotifications(pool, {obligationId: soon, phase: "overdue"}), 0);
});

test("invitations: drafted until provider evidence, only to the invitee's own verified destinations", async () => {
  const s = await destinationServer();
  try {
    const f = await fixture();
    await assert.rejects(q("INSERT INTO debate_invitations(debate_id,invited_candidacy_id,invited_by_candidacy_id) VALUES($1,$2,$3)", [f.debate, f.c.candidacy, f.b.candidacy]), /originator/);
    await assert.rejects(q("INSERT INTO debate_invitations(debate_id,invited_candidacy_id,invited_by_candidacy_id) VALUES($1,$2,$3)", [f.debate, f.unverified.candidacy, f.a.candidacy]), /verified candidacy in the same election/);
    await assert.rejects(q("INSERT INTO debate_invitations(debate_id,invited_candidacy_id,invited_by_candidacy_id) VALUES($1,$2,$3)", [f.debate, f.elsewhere.candidacy, f.a.candidacy]), /same election/);
    const inv = (await one("INSERT INTO debate_invitations(debate_id,invited_candidacy_id,invited_by_candidacy_id) VALUES($1,$2,$3) RETURNING id", [f.debate, f.c.candidacy, f.a.candidacy])).id;
    await assert.rejects(q("INSERT INTO debate_invitations(debate_id,invited_candidacy_id,invited_by_candidacy_id) VALUES($1,$2,$3)", [f.debate, f.c.candidacy, f.a.candidacy]));
    await assert.rejects(q("DELETE FROM debate_invitations WHERE id=$1", [inv]));
    // The originator's own destinations are never used for the invitee.
    await destination(f.a, "webhook", s.base + "/ok", ["notifications"]);
    assert.equal(await enqueueInvitationDelivery(pool, inv), 0, "no invitee destination → nothing queued");
    let [p] = await loadInvitationProjections(pool, f.debate);
    assert.equal(p.state, "drafted");
    assert.equal(p.label, "Invitation drafted — not sent");
    const hook = await destination(f.c, "webhook", s.base + "/flaky", ["notifications"]);
    s.setFailures(1);
    assert.equal(await enqueueInvitationDelivery(pool, inv), 1);
    assert.equal(await enqueueInvitationDelivery(pool, inv), 0, "idempotent");
    await drain(defaultAdapters(testEnv));
    [p] = await loadInvitationProjections(pool, f.debate);
    assert.equal(p.state, "drafted", "a failed attempt is not a sent invitation");
    const act = await one("SELECT id FROM outgoing_actions WHERE subject_kind='invitation' AND subject_id=$1", [inv]);
    await makeDue([act.id]);
    await drain(defaultAdapters(testEnv));
    [p] = await loadInvitationProjections(pool, f.debate);
    assert.equal(p.state, "sent");
    assert.match(p.label, /^Invited .* · Response due /);
    assert.equal(Date.parse(p.responseDueAt) - Date.parse(p.sentAt), 72 * 3600_000);
    assert.equal(JSON.stringify(p).includes("127.0.0.1"), false, "public projection never exposes destinations");
    assert.equal(s.received.filter(e => e.path === "/ok").length, 0);
    const sent = s.received.filter(e => e.path === "/flaky").at(-1);
    assert.equal(JSON.parse(sent.body).type, "pde.invitation");
    assert.equal(verifyWebhookSignature({secret: hook.secret, signature: sent.headers["x-pde-signature"], timestamp: sent.headers["x-pde-timestamp"], eventId: sent.headers["x-pde-event-id"], body: sent.body, nowSeconds: Math.floor(Date.now() / 1000)}), true);
  } finally { s.server.close(); }
});
