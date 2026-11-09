import { after } from "next/server";
import { ApiError, apiRoute, json } from "@/lib/api";
import { collectAnalytics, requestRefresh } from "@/lib/analytics";

export const maxDuration = 120;

/** Fetch fresh metrics for a post now. Each network is asked at most once per 5 minutes. */
export const POST = apiRoute<{ id: string }>(async (_req, { user, params }) => {
  const result = await requestRefresh(user.id, params.id);
  if (result === null) throw new ApiError(404, "Post not found.", "not_found");
  if (result.queued > 0) after(() => collectAnalytics().catch((err) => console.error("[analytics] refresh failed", err)));
  return json(result);
});
