import { apiRoute, json } from "@/lib/api";
import { db } from "@/lib/db";
import { getPlan } from "@/lib/plans";
import { postsThisMonth } from "@/lib/posts";

export const GET = apiRoute(async (_req, { user }) => {
  const plan = getPlan(user.plan);
  const [accounts, posts] = await Promise.all([db.socialAccount.count({ where: { userId: user.id } }), postsThisMonth(user.id)]);
  return json({
    plan: plan.id,
    accounts: { used: accounts, limit: plan.accounts },
    postsThisMonth: { used: posts, limit: plan.postsPerMonth },
  });
});
