import { apiRoute, json } from "@/lib/api";
import { db } from "@/lib/db";
import { platformList } from "@/lib/platforms";
import { sharedAppCredentials } from "@/lib/platform-apps";

export const GET = apiRoute(async (_req, { user }) => {
  const ownApps = new Set((await db.platformApp.findMany({ where: { userId: user.id }, select: { platform: true } })).map((a) => a.platform));
  return json({
    platforms: platformList.map((p) => ({
      id: p.id,
      name: p.name,
      connectType: p.kind,
      available: p.kind === "credentials" || ownApps.has(p.id) || Boolean(sharedAppCredentials(p.id)),
      usesOwnApp: ownApps.has(p.id),
      maxChars: p.maxChars ?? null,
      maxImages: p.maxImages,
      supportsVideo: p.supportsVideo,
      supportsTextOnly: p.supportsText,
      requiresMedia: Boolean(p.requiresMedia),
    })),
  });
});
