import { after } from "next/server";
import { ApiError, apiRoute, json } from "@/lib/api";
import { retryPost } from "@/lib/posts";
import { processDuePosts } from "@/lib/publisher";

export const maxDuration = 300;

export const POST = apiRoute<{ id: string }>(async (_req, { user, params }) => {
  const count = await retryPost(user.id, params.id);
  if (count === null) throw new ApiError(404, "Post not found.", "not_found");
  if (count > 0) after(() => processDuePosts({ maxBatches: 2 }).catch(() => {}));
  return json({ requeued: count });
});
