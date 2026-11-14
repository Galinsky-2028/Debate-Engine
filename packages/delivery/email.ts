import {headerSafe, isLoopbackAddress, loopbackWebhooksAllowed, validateEmailAddress, WEBHOOK_TIMEOUT_MS} from "../domain/outbox.ts";
import type {AttemptOutcome} from "../domain/outbox.ts";

export type EmailConfig = {url: string; apiKey: string; from: string};

/** Generic HTTPS JSON email provider. Returns null (unconfigured) unless every setting is present and valid. */
export function emailProviderConfig(env: Record<string, string | undefined>): EmailConfig | null {
  const url = env.EMAIL_API_URL?.trim(), apiKey = env.EMAIL_API_KEY?.trim(), from = env.EMAIL_FROM?.trim();
  if (!url || !apiKey || !from) return null;
  let parsed: URL;
  try { parsed = new URL(url); } catch { return null; }
  const loopbackTest = loopbackWebhooksAllowed(env) && parsed.protocol === "http:" && isLoopbackAddress(parsed.hostname);
  if (parsed.protocol !== "https:" && !loopbackTest) return null;
  try { return {url: parsed.toString(), apiKey, from: validateEmailAddress(from)}; } catch { return null; }
}

/**
 * Submit one message for one mailbox. A 2xx is provider ACCEPTANCE only, never proof of delivery.
 * Every header-like field is stripped of CR/LF so a stored label or subject cannot inject headers.
 */
export async function sendEmail(config: EmailConfig | null, message: {to: string; subject: string; text: string}, fetcher: typeof fetch = fetch): Promise<AttemptOutcome> {
  if (!config) return {kind: "unconfigured"};
  let to: string;
  try { to = validateEmailAddress(headerSafe(message.to, 254)); } catch { return {kind: "failed", retryable: false, error: "Invalid recipient address."}; }
  const body = JSON.stringify({from: headerSafe(config.from, 254), to, subject: headerSafe(message.subject, 200), text: String(message.text).slice(0, 20_000)});
  let response: Response;
  try {
    response = await fetcher(config.url, {
      method: "POST", redirect: "error", signal: AbortSignal.timeout(WEBHOOK_TIMEOUT_MS),
      headers: {"content-type": "application/json", authorization: "Bearer " + config.apiKey},
      body,
    });
  } catch (error) {
    return {kind: "failed", retryable: true, error: "Email provider unreachable: " + headerSafe(error instanceof Error ? error.message : "network error", 200)};
  }
  const text = (await response.text().catch(() => "")).slice(0, 4000);
  if (response.ok) {
    let receipt = "http-" + response.status;
    try { const json = JSON.parse(text); const id = json?.id ?? json?.messageId ?? json?.message_id; if (typeof id === "string" || typeof id === "number") receipt = headerSafe(String(id), 200); } catch {}
    return {kind: "accepted", receipt};
  }
  const retryable = response.status === 408 || response.status === 429 || response.status >= 500;
  return {kind: "failed", retryable, error: "Email provider refused with HTTP " + response.status};
}
