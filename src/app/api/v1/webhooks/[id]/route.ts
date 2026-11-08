import { ApiError, apiRoute, json } from "@/lib/api";
import { db } from "@/lib/db";

export const DELETE = apiRoute<{ id: string }>(async (_req, { user, params }) => {
  const { count } = await db.webhook.deleteMany({ where: { id: params.id, userId: user.id } });
  if (!count) throw new ApiError(404, "Webhook not found.", "not_found");
  return json({ deleted: true });
});
