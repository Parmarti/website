import { after, NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { ApiError, apiRoute, json, readJson } from "@/lib/api";
import { db } from "@/lib/db";
import { createPost } from "@/lib/posts";
import { processDuePosts } from "@/lib/publisher";
import { serializePost } from "@/lib/serializers";

export const runtime = "nodejs";
export const maxDuration = 300;

export const POST = apiRoute(async (req, { user }) => {
  // Same Idempotency-Key = same post. Lets clients retry safely after a network error.
  const key = req.headers.get("idempotency-key")?.trim() || null;
  if (key && key.length > 255) throw new ApiError(400, "Idempotency-Key must be 255 characters or fewer.", "validation_error");
  const replay = async () => {
    const existing = key ? await db.post.findUnique({ where: { userId_idempotencyKey: { userId: user.id, idempotencyKey: key } }, include: { targets: true } }) : null;
    return existing ? NextResponse.json({ post: serializePost(existing) }, { status: 200, headers: { "Idempotent-Replayed": "true" } }) : null;
  };
  const previous = await replay();
  if (previous) return previous;

  let post;
  try {
    post = await createPost(user, await readJson(req), "api", key);
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
      const raced = await replay();
      if (raced) return raced;
    }
    throw err;
  }
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
