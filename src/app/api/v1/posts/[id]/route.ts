import { ApiError, apiRoute, json } from "@/lib/api";
import { db } from "@/lib/db";
import { cancelPost } from "@/lib/posts";
import { serializePost } from "@/lib/serializers";

export const GET = apiRoute<{ id: string }>(async (_req, { user, params }) => {
  const post = await db.post.findFirst({ where: { id: params.id, userId: user.id }, include: { targets: true } });
  if (!post) throw new ApiError(404, "Post not found.", "not_found");
  return json({ post: serializePost(post) });
});

export const DELETE = apiRoute<{ id: string }>(async (_req, { user, params }) => {
  const result = await cancelPost(user.id, params.id);
  if (!result) throw new ApiError(404, "Post not found.", "not_found");
  return json(result);
});
