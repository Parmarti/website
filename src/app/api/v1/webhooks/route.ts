import { z } from "zod";
import { ApiError, apiRoute, json, readJson } from "@/lib/api";
import { db } from "@/lib/db";
import { serializeWebhook } from "@/lib/serializers";
import { WEBHOOK_EVENTS, newWebhookSecret } from "@/lib/webhooks";
import { assertPublicUrl } from "@/lib/net";

const schema = z.object({
  url: z.string().url(),
  events: z.array(z.enum(WEBHOOK_EVENTS)).default([]),
});

export const GET = apiRoute(async (_req, { user }) => {
  const hooks = await db.webhook.findMany({ where: { userId: user.id }, orderBy: { createdAt: "asc" } });
  return json({ webhooks: hooks.map((h) => serializeWebhook(h)) });
});

export const POST = apiRoute(async (req, { user }) => {
  const body = schema.parse(await readJson(req));
  try {
    await assertPublicUrl(body.url);
  } catch (err) {
    throw new ApiError(400, (err as Error).message, "invalid_url");
  }
  if ((await db.webhook.count({ where: { userId: user.id } })) >= 10) throw new ApiError(400, "You can have at most 10 webhooks.", "limit");
  const hook = await db.webhook.create({ data: { userId: user.id, url: body.url, events: body.events, secret: newWebhookSecret() } });
  return json({ webhook: serializeWebhook(hook, true) }, 201);
});
