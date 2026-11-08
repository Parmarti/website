import { after } from "next/server";
import { apiRoute, json, readJson } from "@/lib/api";
import { db } from "@/lib/db";
import { createPost } from "@/lib/posts";
import { processDuePosts } from "@/lib/publisher";
import { serializePost } from "@/lib/serializers";

export const runtime = "nodejs";
export const maxDuration = 300;

export const POST = apiRoute(async (req, { user }) => {
  const post = await createPost(user, await readJson(req), "api");
  if (post.status === "scheduled" && post.scheduledFor <= new Date()) {
    after(() => processDuePosts({ maxBatches: 2 }).catch((err) => console.error("[posts] immediate publish failed", err)));
  }
  return json({ post: serializePost(post) }, 201);
});

export const GET = apiRoute(async (req, { user }) => {
  const url = req.nextUrl;
  const limit = Math.min(Number(url.searchParams.get("limit")) || 20, 100);
  const cursor = url.searchParams.get("cursor");
  const status = url.searchParams.get("status");
  const profileId = url.searchParams.get("profileId");
  const posts = await db.post.findMany({
    where: { userId: user.id, ...(status ? { status } : {}), ...(profileId ? { profileId } : {}) },
    include: { targets: true },
    orderBy: { createdAt: "desc" },
    take: limit + 1,
    ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
  });
  const hasMore = posts.length > limit;
  const page = posts.slice(0, limit);
  return json({ posts: page.map(serializePost), nextCursor: hasMore ? page[page.length - 1].id : null });
});
