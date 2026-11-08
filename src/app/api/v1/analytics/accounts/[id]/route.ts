import { ApiError, apiRoute, json } from "@/lib/api";
import { getAccountAnalytics, parseRange } from "@/lib/analytics";

/** Follower history of one account. Query: from, to or days (default 30). */
export const GET = apiRoute<{ id: string }>(async (req, { user, params }) => {
  const result = await getAccountAnalytics(user.id, params.id, parseRange(req.nextUrl.searchParams));
  if (!result) throw new ApiError(404, "Account not found.", "not_found");
  return json(result);
});
