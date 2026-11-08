// Dev only: fill an existing user's workspace with 30 days of sample posts, metrics and follower history,
// to demo or screenshot the analytics dashboard. Never run against production.
// Usage: npx tsx scripts/dev-seed-analytics.ts user@example.com
import { db } from "../src/lib/db";

const NETWORKS: { platform: string; name: string; followers: number; audience: "impressions" | "views" | null; reach: number }[] = [
  { platform: "linkedin", name: "Ada Lovelace", followers: 0, audience: null, reach: 0 },
  { platform: "instagram", name: "@acme.coffee", followers: 18300, audience: "views", reach: 2600 },
  { platform: "bluesky", name: "acme.bsky.social", followers: 2100, audience: null, reach: 0 },
  { platform: "youtube", name: "Acme Coffee", followers: 9800, audience: "views", reach: 5200 },
  { platform: "twitter", name: "@acmecoffee", followers: 7600, audience: "impressions", reach: 3100 },
];

function rand(seed: number) {
  const x = Math.sin(seed) * 10_000;
  return x - Math.floor(x);
}

async function main() {
  if (process.env.NODE_ENV === "production") throw new Error("Refusing to seed in production.");
  const email = process.argv[2];
  const user = await db.user.findUniqueOrThrow({ where: { email } });
  const profile = await db.profile.findFirstOrThrow({ where: { userId: user.id }, orderBy: { createdAt: "asc" } });
  const day = 86400_000;
  const today = new Date(Date.UTC(new Date().getUTCFullYear(), new Date().getUTCMonth(), new Date().getUTCDate()));

  for (const [n, net] of NETWORKS.entries()) {
    const account = await db.socialAccount.upsert({
      where: { profileId_platform_platformAccountId: { profileId: profile.id, platform: net.platform, platformAccountId: `demo-${net.platform}` } },
      create: { userId: user.id, profileId: profile.id, platform: net.platform, platformAccountId: `demo-${net.platform}`, displayName: net.name, username: net.name, followers: net.followers || null },
      update: { followers: net.followers || null },
    });
    // LinkedIn does not report followers, so it gets no history.
    for (let d = 30; net.followers > 0 && d >= 0; d--) {
      const followers = Math.round(net.followers - d * (8 + n * 6) - rand(d + n) * 20);
      const date = new Date(today.getTime() - d * day);
      await db.accountSnapshot.upsert({
        where: { accountId_date: { accountId: account.id, date } },
        create: { accountId: account.id, date, followers },
        update: { followers },
      });
    }
    for (let d = 29; d >= 0; d--) {
      if (rand(d * 7 + n) < 0.45) continue;
      const publishedAt = new Date(today.getTime() - d * day + (9 + n) * 3600_000);
      const audience = Math.round(net.reach * (0.5 + rand(d + n * 3) * 1.5));
      const likes = Math.round((audience || 600) * (0.02 + rand(d * 3 + n) * 0.05));
      const metrics: Record<string, number> = { likes, comments: Math.round(likes * 0.12), shares: Math.round(likes * 0.08) };
      if (net.audience) metrics[net.audience] = audience;
      if (net.platform === "instagram") metrics.saves = Math.round(likes * 0.1);
      const post = await db.post.create({
        data: {
          userId: user.id,
          profileId: profile.id,
          content: `Demo post ${30 - d} on ${net.platform}: new seasonal roast, brewing tips and behind the scenes.`,
          scheduledFor: publishedAt,
          status: "published",
          publishedAt,
          source: "api",
        },
      });
      await db.postTarget.create({
        data: {
          postId: post.id,
          socialAccountId: account.id,
          platform: net.platform,
          status: "published",
          platformPostId: `demo-${post.id}`,
          publishedAt,
          metrics,
          metricsUpdatedAt: new Date(),
          metricsNextAt: null,
        },
      });
    }
  }
  console.log("Seeded demo analytics for", email);
  await db.$disconnect();
}

main();
