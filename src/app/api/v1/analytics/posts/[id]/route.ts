import { ApiError, apiRoute, json } from "@/lib/api";
import { getPostAnalytics } from "@/lib/analytics";

export const GET = apiRoute<{ id: string }>(async (_req, { user, params }) => {
  const result = await getPostAnalytics(user.id, params.id);
  if (!result) throw new ApiError(404, "Post not found.", "not_found");
  return json(result);
});
