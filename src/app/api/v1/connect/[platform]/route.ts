import { ApiError, apiRoute, json } from "@/lib/api";
import { startConnect } from "@/lib/accounts";
import { isPlatformId } from "@/lib/platforms";

/**
 * Returns a hosted URL that connects a social account. Send your end user there.
 * When they finish, we redirect to `redirectUrl` with ?connected=<platform>&accountId=...&profileId=...
 * or ?error=... on failure.
 */
export const GET = apiRoute<{ platform: string }>(async (req, { user, params }) => {
  if (!isPlatformId(params.platform)) throw new ApiError(404, `Unknown platform '${params.platform}'.`, "unknown_platform");
  const redirectUrl = req.nextUrl.searchParams.get("redirectUrl") || req.nextUrl.searchParams.get("redirect_url");
  if (redirectUrl) {
    try {
      const u = new URL(redirectUrl);
      if (!["http:", "https:"].includes(u.protocol)) throw new Error();
    } catch {
      throw new ApiError(400, "redirectUrl must be an absolute http(s) URL.", "invalid_redirect");
    }
  }
  try {
    const authUrl = await startConnect({
      userId: user.id,
      platform: params.platform,
      profileId: req.nextUrl.searchParams.get("profileId"),
      redirectUrl,
    });
    return json({ authUrl, expiresInSeconds: 1800 });
  } catch (err) {
    throw new ApiError(400, (err as Error).message, "connect_unavailable");
  }
});
