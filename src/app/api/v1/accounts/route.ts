import { apiRoute, json } from "@/lib/api";
import { db } from "@/lib/db";
import { serializeAccount } from "@/lib/serializers";

export const GET = apiRoute(async (req, { user }) => {
  const profileId = req.nextUrl.searchParams.get("profileId");
  const platform = req.nextUrl.searchParams.get("platform");
  const accounts = await db.socialAccount.findMany({
    where: { userId: user.id, ...(profileId ? { profileId } : {}), ...(platform ? { platform } : {}) },
    orderBy: { createdAt: "asc" },
  });
  return json({ accounts: accounts.map(serializeAccount) });
});
