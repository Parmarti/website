// Test helper: create a connect state that waits for account selection (simulates a Facebook login with several Pages).
// Usage: npx tsx scripts/dev-pending-state.ts user@example.com
import { db } from "../src/lib/db";
import { randomToken } from "../src/lib/crypto";
import { storePendingAccounts } from "../src/lib/connect";

async function main() {
  const email = process.argv[2];
  const user = await db.user.findUniqueOrThrow({ where: { email } });
  const profile = await db.profile.findFirstOrThrow({ where: { userId: user.id }, orderBy: { createdAt: "asc" } });
  const state = await db.oAuthState.create({
    data: { state: randomToken(24), userId: user.id, profileId: profile.id, platform: "facebook", redirectUrl: null, expiresAt: new Date(Date.now() + 600_000) },
  });
  const page = (id: string, name: string) => ({
    platformAccountId: id,
    displayName: name,
    username: null,
    avatarUrl: null,
    metadata: { pageId: id },
    token: { accessToken: `PT_${id}`, refreshToken: null, expiresAt: null },
  });
  await storePendingAccounts(state.id, [page("p1", "Cafe Downtown"), page("p2", "Cafe Uptown"), page("p3", "Bakery")]);
  console.log(state.state);
  await db.$disconnect();
}

main();
