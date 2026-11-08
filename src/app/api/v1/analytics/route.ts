import { ApiError, apiRoute, json } from "@/lib/api";
import { getOverview, parseRange } from "@/lib/analytics";
import { isValidTimezone } from "@/lib/time";

/**
 * Analytics overview for posts published in a date range.
 * Query: from, to (ISO date or date-time) or days (default 30), profileId, platform, accountId, timezone (for daily buckets).
 */
export const GET = apiRoute(async (req, { user }) => {
  const q = req.nextUrl.searchParams;
  const timezone = q.get("timezone") || "UTC";
  if (!isValidTimezone(timezone)) throw new ApiError(400, `Unknown timezone '${timezone}'.`, "validation_error");
  const { from, to } = parseRange(q);
  const overview = await getOverview(user.id, {
    from,
    to,
    timezone,
    profileId: q.get("profileId"),
    platform: q.get("platform"),
    accountId: q.get("accountId"),
  });
  return json(overview);
});
