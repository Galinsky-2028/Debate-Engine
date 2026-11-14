import {lookup as dnsLookup} from "node:dns/promises";
import {request as httpRequest} from "node:http";
import {request as httpsRequest} from "node:https";
import {isIP} from "node:net";
import {
  isForbiddenAddress, isLoopbackAddress, signWebhook, validateWebhookUrl,
  WEBHOOK_MAX_REQUEST_BYTES, WEBHOOK_MAX_RESPONSE_BYTES, WEBHOOK_TIMEOUT_MS,
} from "../domain/outbox.ts";

export class DeliveryRefused extends Error {}
export type Resolver = (host: string) => Promise<Array<{address: string; family: number}>>;
const defaultResolver: Resolver = host => dnsLookup(host, {all: true, verbatim: true});

/** Resolve once, refuse non-public answers, then connect to the vetted address (no DNS rebinding window). */
async function vettedAddress(url: URL, allowLoopback: boolean, resolve: Resolver) {
  const host = url.hostname.replace(/^\[|\]$/g, "");
  const answers = isIP(host) ? [{address: host, family: isIP(host)}] : await resolve(host);
  if (!answers.length) throw new DeliveryRefused("Webhook host did not resolve.");
  for (const a of answers) {
    if (allowLoopback && isLoopbackAddress(a.address)) continue;
    if (isForbiddenAddress(a.address)) throw new DeliveryRefused("Webhook host resolves to a non-public address.");
  }
  return answers[0];
}

export type WebhookResponse = {status: number; body: string};

/** POST a signed JSON body. HTTPS only, no redirects, 10 s timeout, capped request and response sizes. */
export async function postSignedWebhook(input: {
  url: string; secret: string; eventId: string; body: string;
  allowLoopback?: boolean; resolve?: Resolver; nowSeconds?: number;
}): Promise<WebhookResponse> {
  const allowLoopback = input.allowLoopback === true;
  let url: URL;
  try { url = validateWebhookUrl(input.url, {allowLoopback}); } catch (e) { throw new DeliveryRefused((e as Error).message); }
  const bytes = Buffer.from(input.body, "utf8");
  if (bytes.length > WEBHOOK_MAX_REQUEST_BYTES) throw new DeliveryRefused("Webhook body exceeds the size limit.");
  const target = await vettedAddress(url, allowLoopback, input.resolve ?? defaultResolver);
  const timestamp = input.nowSeconds ?? Math.floor(Date.now() / 1000);
  const signature = signWebhook(input.secret, timestamp, input.eventId, input.body);
  const secure = url.protocol === "https:";
  const host = url.hostname.replace(/^\[|\]$/g, "");
  return await new Promise<WebhookResponse>((resolve, reject) => {
    const req = (secure ? httpsRequest : httpRequest)({
      host: target.address, family: target.family, port: url.port || (secure ? 443 : 80),
      path: url.pathname + url.search, method: "POST",
      ...(secure && !isIP(host) ? {servername: host} : {}),
      headers: {
        host: url.host, "content-type": "application/json", "content-length": String(bytes.length),
        "user-agent": "PublicDebateEngine-Webhook/1", "x-pde-event-id": input.eventId,
        "x-pde-timestamp": String(timestamp), "x-pde-signature": signature,
      },
      timeout: WEBHOOK_TIMEOUT_MS,
    }, res => {
      const chunks: Buffer[] = [];
      let size = 0;
      res.on("data", (chunk: Buffer) => {
        size += chunk.length;
        if (size <= WEBHOOK_MAX_RESPONSE_BYTES) chunks.push(chunk);
        else res.destroy();
      });
      const finish = () => resolve({status: res.statusCode ?? 0, body: Buffer.concat(chunks).toString("utf8").slice(0, WEBHOOK_MAX_RESPONSE_BYTES)});
      res.on("end", finish);
      res.on("close", finish);
      res.on("error", () => finish());
    });
    const timer = setTimeout(() => req.destroy(new Error("Webhook timed out after 10 seconds.")), WEBHOOK_TIMEOUT_MS);
    req.on("timeout", () => req.destroy(new Error("Webhook timed out after 10 seconds.")));
    req.on("error", error => { clearTimeout(timer); reject(error); });
    req.on("close", () => clearTimeout(timer));
    req.end(bytes);
  });
}

/** Destination proof of control: POST a signed one-time challenge; the endpoint must echo it (JSON {challenge} or plain text). */
export async function runWebhookChallenge(input: {url: string; secret: string; challenge: string; eventId: string; allowLoopback?: boolean; resolve?: Resolver}): Promise<{ok: boolean; detail: string}> {
  const body = JSON.stringify({id: input.eventId, type: "pde.destination.verification", createdAt: new Date().toISOString(), data: {challenge: input.challenge}});
  try {
    const res = await postSignedWebhook({url: input.url, secret: input.secret, eventId: input.eventId, body, allowLoopback: input.allowLoopback, resolve: input.resolve});
    let echoed: unknown = res.body.trim();
    try { echoed = (JSON.parse(res.body) as {challenge?: unknown}).challenge; } catch {}
    const success = res.status >= 200 && res.status < 300;
    if (success && echoed === input.challenge) return {ok: true, detail: ""};
    return {ok: false, detail: success ? "The endpoint did not echo the challenge token." : `The endpoint responded HTTP ${res.status}.`};
  } catch (e) {
    return {ok: false, detail: e instanceof DeliveryRefused ? e.message : "The endpoint could not be reached."};
  }
}
