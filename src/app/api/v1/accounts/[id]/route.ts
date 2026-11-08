import { ApiError, apiRoute, json } from "@/lib/api";
import { db } from "@/lib/db";
import { disconnectAccount } from "@/lib/accounts";
import { serializeAccount } from "@/lib/serializers";

export const GET = apiRoute<{ id: string }>(async (_req, { user, params }) => {
  const account = await db.socialAccount.findFirst({ where: { id: params.id, userId: user.id } });
  if (!account) throw new ApiError(404, "Account not found.", "not_found");
  return json({ account: serializeAccount(account) });
});

export const DELETE = apiRoute<{ id: string }>(async (_req, { user, params }) => {
  if (!(await disconnectAccount(user.id, params.id))) throw new ApiError(404, "Account not found.", "not_found");
  return json({ deleted: true });
});
