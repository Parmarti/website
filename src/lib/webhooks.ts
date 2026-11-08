import { db } from "./db";
import { hmacSha256, randomToken } from "./crypto";
import { brand } from "./brand";
import { assertPublicUrl } from "./net";

export const WEBHOOK_EVENTS = [
  "post.published",
  "post.partial",
  "post.failed",
  "account.connected",
  "account.disconnected",
  "account.expired",
] as const;
export type WebhookEvent = (typeof WEBHOOK_EVENTS)[number];

export function newWebhookSecret() {
  return `whsec_${randomToken(24)}`;
}

export function signPayload(secret: string, timestamp: number, body: string) {
  return `t=${timestamp},v1=${hmacSha256(secret, `${timestamp}.${body}`)}`;
}

async function deliver(hook: { id: string; url: string; secret: string }, event: string, data: unknown) {
  const body = JSON.stringify({ id: `evt_${randomToken(12)}`, event, createdAt: new Date().toISOString(), data });
  let lastStatus: number | null = null;
  let lastError: string | null = null;
  for (let attempt = 0; attempt < 3; attempt++) {
    if (attempt) await new Promise((r) => setTimeout(r, attempt * 2000));
    try {
      await assertPublicUrl(hook.url);
      const ts = Math.floor(Date.now() / 1000);
      const res = await fetch(hook.url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "User-Agent": `${brand.name}-Webhooks/1.0`,
          [brand.webhookSignatureHeader]: signPayload(hook.secret, ts, body),
        },
        body,
        signal: AbortSignal.timeout(10_000),
      });
      lastStatus = res.status;
      lastError = res.ok ? null : `HTTP ${res.status}`;
      if (res.ok || (res.status >= 400 && res.status < 500 && res.status !== 429)) break;
    } catch (err) {
      lastError = (err as Error).message;
    }
  }
  await db.webhook.update({ where: { id: hook.id }, data: { lastStatus, lastError, lastDelivered: new Date() } }).catch(() => {});
  return { status: lastStatus, error: lastError };
}

/** Send an event to every active webhook of the user that subscribes to it. Never throws. */
export async function emitEvent(userId: string, event: WebhookEvent | "webhook.test", data: unknown, onlyWebhookId?: string) {
  try {
    const hooks = await db.webhook.findMany({ where: { userId, active: true, ...(onlyWebhookId ? { id: onlyWebhookId } : {}) } });
    const targets = hooks.filter((h) => onlyWebhookId || h.events.length === 0 || h.events.includes(event));
    return await Promise.all(targets.map((h) => deliver(h, event, data)));
  } catch (err) {
    console.error("[webhooks] emit failed", err);
    return [];
  }
}
