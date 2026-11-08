import { ApiError, apiRoute, json } from "@/lib/api";
import { db } from "@/lib/db";
import { emitEvent } from "@/lib/webhooks";

export const POST = apiRoute<{ id: string }>(async (_req, { user, params }) => {
  const hook = await db.webhook.findFirst({ where: { id: params.id, userId: user.id } });
  if (!hook) throw new ApiError(404, "Webhook not found.", "not_found");
  const [result] = await emitEvent(user.id, "webhook.test", { message: "This is a test event." }, hook.id);
  return json({ delivered: result?.error == null, status: result?.status ?? null, error: result?.error ?? null });
});
