import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {
  backoffSeconds, canTransition, deliveryLabel, dueSoonAt, headerSafe, isForbiddenAddress, loopbackWebhooksAllowed,
  obligationNotificationText, OUTBOX_MAX_ATTEMPTS, resultAfterAttempt, signWebhook, validateEmailAddress, validatePurposes,
  validateWebhookUrl, verifyWebhookSignature,
} from "../packages/domain/outbox.ts";
import {projectInvitation} from "../packages/domain/invitations.ts";
import {emailProviderConfig, sendEmail} from "../packages/delivery/email.ts";
import {postSignedWebhook, DeliveryRefused} from "../packages/delivery/webhook.ts";

const secret = "s".repeat(43);

test("backoff grows, is bounded, and rejects nonsense attempt counts", () => {
  const schedule = Array.from({length: 10}, (_, i) => backoffSeconds(i + 1));
  for (let i = 1; i < schedule.length; i++) assert.ok(schedule[i] >= schedule[i - 1]);
  assert.equal(schedule[0], 30);
  assert.equal(schedule[9], 12 * 3600);
  assert.ok(backoffSeconds(1, () => 1) <= 36);
  assert.throws(() => backoffSeconds(0));
});

test("a retryable failure retries until max attempts, then becomes a dead letter", () => {
  const failed = {kind: "failed" as const, retryable: true, error: "HTTP 503"};
  const mid = resultAfterAttempt({attempts: 3, maxAttempts: OUTBOX_MAX_ATTEMPTS, outcome: failed});
  assert.equal(mid.state, "failed");
  assert.equal(mid.retryInSeconds, backoffSeconds(3));
  assert.equal(mid.lastError, "HTTP 503");
  const last = resultAfterAttempt({attempts: OUTBOX_MAX_ATTEMPTS, maxAttempts: OUTBOX_MAX_ATTEMPTS, outcome: failed});
  assert.equal(last.state, "dead");
  assert.equal(last.retryInSeconds, null);
  const permanent = resultAfterAttempt({attempts: 1, maxAttempts: 8, outcome: {kind: "failed", retryable: false, error: "SSRF refused"}});
  assert.equal(permanent.state, "dead");
  assert.equal(deliveryLabel({state: "dead", attempts: 1, maxAttempts: 8}), "failed");
  assert.equal(deliveryLabel({state: "dead", attempts: 8, maxAttempts: 8}), "dead");
});

test("states stay honest: provider acceptance is not delivery and an unconfigured provider is never sent", () => {
  const accepted = resultAfterAttempt({attempts: 1, maxAttempts: 8, outcome: {kind: "accepted", receipt: "msg-1"}});
  assert.equal(accepted.state, "accepted");
  assert.equal(accepted.markDelivered, false);
  const delivered = resultAfterAttempt({attempts: 1, maxAttempts: 8, outcome: {kind: "delivered", receipt: "http-200"}});
  assert.equal(delivered.state, "delivered");
  assert.ok(delivered.markAccepted && delivered.markDelivered);
  const unconfigured = resultAfterAttempt({attempts: 8, maxAttempts: 8, outcome: {kind: "unconfigured"}});
  assert.equal(unconfigured.state, "pending");
  assert.equal(unconfigured.lastError, "provider_unconfigured");
  assert.equal(unconfigured.attemptsDelta, -1);
  assert.equal(unconfigured.markAccepted, false);
  assert.equal(deliveryLabel({state: "pending", attempts: 0, maxAttempts: 8}), "queued");
  assert.equal(deliveryLabel({state: "accepted", attempts: 1, maxAttempts: 8}), "provider_accepted");
  assert.equal(deliveryLabel({state: "failed", attempts: 2, maxAttempts: 8}), "retrying");
});

test("success is terminal; only dead letters may be requeued", () => {
  assert.equal(canTransition("delivered", "sending"), false);
  assert.equal(canTransition("delivered", "pending"), false);
  assert.equal(canTransition("accepted", "sending"), false);
  assert.equal(canTransition("accepted", "delivered"), true);
  assert.equal(canTransition("dead", "pending"), true);
  assert.equal(canTransition("failed", "sending"), true);
  assert.equal(canTransition("pending", "accepted"), false);
  const sql = readFileSync("packages/database/migrations/0028_delivery_destinations_outbox.sql", "utf8");
  assert.match(sql, /OLD\.state='accepted' AND NEW\.state IN \('accepted','delivered'\)/);
  assert.match(sql, /Delivery evidence is permanent/);
});

test("signatures cover timestamp, event id and body, with a replay window", () => {
  const sig = signWebhook(secret, 1_800_000_000, "evt-1", "{\"a\":1}");
  assert.match(sig, /^v1=[0-9a-f]{64}$/);
  const ok = {secret, signature: sig, timestamp: 1_800_000_000, eventId: "evt-1", body: "{\"a\":1}", nowSeconds: 1_800_000_100};
  assert.equal(verifyWebhookSignature(ok), true);
  assert.equal(verifyWebhookSignature({...ok, body: "{\"a\":2}"}), false);
  assert.equal(verifyWebhookSignature({...ok, eventId: "evt-2"}), false);
  assert.equal(verifyWebhookSignature({...ok, nowSeconds: 1_800_000_000 + 301}), false, "stale timestamps are refused");
  assert.equal(verifyWebhookSignature({...ok, secret: "x".repeat(43)}), false);
  assert.throws(() => signWebhook("short", 1, "e", ""));
});

test("SSRF rules refuse private, loopback, link-local, metadata and mapped addresses", () => {
  for (const ip of ["127.0.0.1", "10.1.2.3", "172.16.0.1", "172.31.255.255", "192.168.1.1", "169.254.169.254", "0.0.0.0", "100.64.0.1",
    "224.0.0.1", "255.255.255.255", "::1", "::", "fe80::1", "fc00::1", "fd00:ec2::254", "::ffff:127.0.0.1", "::ffff:169.254.169.254",
    "64:ff9b::a9fe:a9fe", "2002:7f00:1::", "ff02::1", "2001:db8::1", "not-an-ip"])
    assert.equal(isForbiddenAddress(ip), true, ip);
  for (const ip of ["93.184.216.34", "8.8.8.8", "172.32.0.1", "2606:4700:4700::1111", "::ffff:8.8.8.8"])
    assert.equal(isForbiddenAddress(ip), false, ip);
});

test("webhook URLs must be HTTPS public hosts without credentials; loopback only in explicit test mode", () => {
  assert.equal(validateWebhookUrl("https://hooks.example.org/pde").hostname, "hooks.example.org");
  for (const bad of ["http://hooks.example.org/x", "https://user:pw@hooks.example.org/", "https://localhost/x", "https://127.0.0.1/x",
    "https://[::1]/x", "https://169.254.169.254/latest", "https://metadata.google.internal/", "https://intranet/", "https://a.example.org:22/",
    "ftp://example.org/", "https://example.org/#frag", "https://example.org/\nX-Evil: 1"])
    assert.throws(() => validateWebhookUrl(bad), bad);
  assert.throws(() => validateWebhookUrl("http://127.0.0.1:9999/hook"));
  assert.equal(validateWebhookUrl("http://127.0.0.1:9999/hook", {allowLoopback: true}).port, "9999");
  assert.throws(() => validateWebhookUrl("http://10.0.0.1:9999/hook", {allowLoopback: true}));
  assert.equal(loopbackWebhooksAllowed({NODE_ENV: "production", PDE_ALLOW_LOOPBACK_WEBHOOKS: "true"}), false);
  assert.equal(loopbackWebhooksAllowed({NODE_ENV: "test", PDE_ALLOW_LOOPBACK_WEBHOOKS: "true"}), true);
  assert.equal(loopbackWebhooksAllowed({NODE_ENV: "test"}), false);
});

test("DNS answers are vetted before connecting (no rebinding to private addresses)", async () => {
  await assert.rejects(postSignedWebhook({url: "https://hooks.example.org/x", secret, eventId: "e", body: "{}",
    resolve: async () => [{address: "93.184.216.34", family: 4}, {address: "10.0.0.5", family: 4}]}), DeliveryRefused);
  await assert.rejects(postSignedWebhook({url: "https://hooks.example.org/x", secret, eventId: "e", body: "{}",
    resolve: async () => [{address: "::ffff:169.254.169.254", family: 6}]}), DeliveryRefused);
  await assert.rejects(postSignedWebhook({url: "https://hooks.example.org/x", secret, eventId: "e", body: "x".repeat(70_000),
    resolve: async () => [{address: "93.184.216.34", family: 4}]}), DeliveryRefused);
});

test("email: one mailbox only, header injection stripped, unconfigured provider never sends", async () => {
  assert.equal(validateEmailAddress(" Press@Example.org "), "press@example.org");
  for (const bad of ["a@b.org,c@d.org", "a@b.org;c@d.org", "Name <a@b.org>", "a@b.org\r\nBcc: x@y.org", "a b@c.org", "nobody", "a@localhost"])
    assert.throws(() => validateEmailAddress(bad), bad);
  assert.equal(headerSafe("Hello\r\nBcc: victim@example.org"), "Hello Bcc: victim@example.org");
  assert.equal(emailProviderConfig({}), null);
  assert.equal(emailProviderConfig({EMAIL_API_URL: "http://mail.example.org", EMAIL_API_KEY: "k", EMAIL_FROM: "a@b.org"}), null, "plain HTTP is refused");
  let called = false;
  const fetcher = (async () => { called = true; return new Response("{}"); }) as typeof fetch;
  assert.deepEqual(await sendEmail(null, {to: "a@b.org", subject: "s", text: "t"}, fetcher), {kind: "unconfigured"});
  assert.equal(called, false);
  const config = emailProviderConfig({EMAIL_API_URL: "https://mail.example.org/send", EMAIL_API_KEY: "k", EMAIL_FROM: "notices@example.org"})!;
  let sent: Record<string, string> = {};
  const capture = (async (_url: string, init: RequestInit) => { sent = JSON.parse(String(init.body)); return new Response(JSON.stringify({id: "m-1"}), {status: 202}); }) as unknown as typeof fetch;
  const outcome = await sendEmail(config, {to: "a@b.org", subject: "Due\r\nBcc: x@y.org", text: "body"}, capture);
  assert.deepEqual(outcome, {kind: "accepted", receipt: "m-1"});
  assert.equal(sent.subject.includes("\n"), false);
  const refused = await sendEmail(config, {to: "a@b.org", subject: "s", text: "t"}, (async () => new Response("no", {status: 422})) as typeof fetch);
  assert.deepEqual(refused, {kind: "failed", retryable: false, error: "Email provider refused with HTTP 422"});
  const busy = await sendEmail(config, {to: "a@b.org", subject: "s", text: "t"}, (async () => new Response("", {status: 503})) as typeof fetch);
  assert.equal(busy.kind === "failed" && busy.retryable, true);
});

test("purposes are a strict subset of notifications/distribution", () => {
  assert.deepEqual(validatePurposes(["distribution", "notifications", "distribution"]), ["distribution", "notifications"]);
  assert.throws(() => validatePurposes([]));
  assert.throws(() => validatePurposes(["marketing"]));
  assert.throws(() => validatePurposes("notifications"));
});

test("notification wording is neutral and never claims a concession", () => {
  for (const phase of ["opened", "due_soon", "overdue"] as const) {
    const m = obligationNotificationText({phase, obligationType: "reply", debateTitle: "Fictional title\r\nBcc: x", effectiveDueAt: "2032-01-05T10:00:00Z", debateUrl: "https://example.org/debates/1"});
    assert.doesNotMatch(m.subject + m.text, /conced|defeat|lost|forfeit|refus/i);
    assert.equal(/[\r\n]/.test(m.subject), false);
  }
  assert.match(obligationNotificationText({phase: "overdue", obligationType: "reply", debateTitle: "T", effectiveDueAt: "2032-01-05T10:00:00Z", debateUrl: "u"}).subject, /^No response received by 2032-01-05 10:00 UTC/);
  assert.match(obligationNotificationText({phase: "due_soon", obligationType: "reply", debateTitle: "T", effectiveDueAt: "2032-01-05T10:00:00Z", debateUrl: "u"}).subject, /^Response due/);
});

test("due-soon notices only for windows longer than 48 hours, 24 hours before the effective deadline", () => {
  assert.equal(dueSoonAt("2032-01-01T00:00:00Z", "2032-01-03T00:00:00Z"), null);
  assert.equal(dueSoonAt("2032-01-01T00:00:00Z", "2032-01-04T00:00:00Z"), "2032-01-03T00:00:00.000Z");
});

test("invitations: drafted is not sent, nobody is accused without provider evidence", () => {
  const base = {debatePublishedAt: "2032-01-01T00:00:00Z", replyWindowHours: 72, respondedAt: null};
  const drafted = projectInvitation({...base, providerEvidenceAt: null, now: "2033-01-01T00:00:00Z"});
  assert.equal(drafted.state, "drafted");
  assert.equal(drafted.label, "Invitation drafted — not sent");
  assert.equal(drafted.responseDueAt, null);
  const sent = projectInvitation({...base, providerEvidenceAt: "2032-01-02T00:00:00Z", now: "2032-01-03T00:00:00Z"});
  assert.equal(sent.state, "sent");
  assert.equal(sent.responseDueAt, "2032-01-05T00:00:00.000Z");
  assert.match(sent.label, /^Invited 2032-01-02 00:00 UTC · Response due 2032-01-05 00:00 UTC$/);
  const early = projectInvitation({...base, debatePublishedAt: "2032-01-02T00:00:00Z", providerEvidenceAt: "2032-01-01T00:00:00Z", now: "2032-01-02T01:00:00Z"});
  assert.equal(early.sentAt, "2032-01-02T00:00:00.000Z", "clock cannot start before publication");
  const missed = projectInvitation({...base, providerEvidenceAt: "2032-01-02T00:00:00Z", now: "2032-01-06T00:00:00Z"});
  assert.equal(missed.label, "No response received by 2032-01-05 00:00 UTC");
  const answered = projectInvitation({...base, providerEvidenceAt: "2032-01-02T00:00:00Z", respondedAt: "2032-01-07T00:00:00Z", now: "2032-01-08T00:00:00Z"});
  assert.equal(answered.state, "responded");
  const noWindow = projectInvitation({...base, replyWindowHours: null, providerEvidenceAt: "2032-01-02T00:00:00Z", now: "2040-01-01T00:00:00Z"});
  assert.equal(noWindow.state, "sent");
});

test("worker sources: claim with SKIP LOCKED + lease, lease-guarded results, enqueue idempotent", () => {
  const store = readFileSync("packages/delivery/outbox-store.ts", "utf8");
  assert.match(store, /FOR UPDATE SKIP LOCKED/);
  assert.match(store, /WHERE id=\$1 AND lease_token=\$2 AND state='sending'/);
  assert.match(store, /ON CONFLICT\(action_type,destination,dedupe_key\) DO NOTHING/);
  const worker = readFileSync("scripts/outbox-worker.mjs", "utf8");
  assert.match(worker, /packages\/delivery\/outbox-store\.ts/);
  const deadline = readFileSync("scripts/deadline-worker.mjs", "utf8");
  assert.match(deadline, /enqueueObligationNotifications\(db,\{obligationId:current\.id,phase:"overdue"\}\)/);
});
