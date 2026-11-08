import { z } from "zod";
import type { User } from "@prisma/client";
import { db } from "./db";
import { getPlan } from "./plans";
import { getAdapter, type MediaItem } from "./platforms";
import { isValidTimezone, parseScheduledFor } from "./time";

export const mediaItemSchema = z.object({
  type: z.enum(["image", "video"]).optional(),
  url: z.string().url(),
  altText: z.string().max(1500).optional(),
});

export const createPostSchema = z.object({
  content: z.string().max(100_000).default(""),
  mediaItems: z.array(mediaItemSchema).max(20).default([]),
  platforms: z
    .array(
      z.object({
        platform: z.string().optional(),
        accountId: z.string().min(1),
        content: z.string().max(100_000).optional(),
        platformSpecificData: z.record(z.unknown()).optional(),
      }),
    )
    .min(1, "Add at least one account to post to."),
  scheduledFor: z.string().optional(),
  timezone: z.string().default("UTC"),
  publishNow: z.boolean().optional(),
  isDraft: z.boolean().optional(),
  profileId: z.string().optional(),
  externalId: z.string().max(200).optional(),
});

export type CreatePostInput = z.infer<typeof createPostSchema>;

export class PostValidationError extends Error {
  constructor(message: string, public status: number, public details?: unknown) {
    super(message);
  }
}

const VIDEO_EXT = /\.(mp4|mov|m4v|webm|avi|mkv)(\?|#|$)/i;

export function normalizeMedia(items: CreatePostInput["mediaItems"]): MediaItem[] {
  return items.map((m) => ({
    type: m.type ?? (VIDEO_EXT.test(m.url) ? "video" : "image"),
    url: m.url,
    ...(m.altText ? { altText: m.altText } : {}),
  }));
}

export async function postsThisMonth(userId: string) {
  const start = new Date();
  start.setUTCDate(1);
  start.setUTCHours(0, 0, 0, 0);
  return db.post.count({ where: { userId, createdAt: { gte: start } } });
}

export async function createPost(user: User, raw: unknown, source: "api" | "dashboard" = "api", idempotencyKey?: string | null) {
  const input = createPostSchema.parse(raw);
  const plan = getPlan(user.plan);

  if (!isValidTimezone(input.timezone)) throw new PostValidationError(`Unknown timezone '${input.timezone}'. Use an IANA name like 'America/New_York'.`, 400);

  if (plan.postsPerMonth !== null && (await postsThisMonth(user.id)) >= plan.postsPerMonth) {
    throw new PostValidationError(`Your ${plan.name} plan includes ${plan.postsPerMonth} posts per month. Upgrade for unlimited posts.`, 402);
  }
  const accountCount = await db.socialAccount.count({ where: { userId: user.id } });
  if (accountCount > plan.accounts) {
    throw new PostValidationError(
      `Your ${plan.name} plan allows ${plan.accounts} connected accounts and you have ${accountCount}. Upgrade or disconnect accounts to keep posting.`,
      402,
    );
  }

  const accountIds = [...new Set(input.platforms.map((p) => p.accountId))];
  const accounts = await db.socialAccount.findMany({ where: { id: { in: accountIds }, userId: user.id } });
  const byId = new Map(accounts.map((a) => [a.id, a]));
  const media = normalizeMedia(input.mediaItems);

  const problems: { accountId: string; platform?: string; errors: string[] }[] = [];
  for (const target of input.platforms) {
    const account = byId.get(target.accountId);
    if (!account) {
      problems.push({ accountId: target.accountId, errors: ["Account not found."] });
      continue;
    }
    const errors: string[] = [];
    if (target.platform && target.platform !== account.platform) errors.push(`Account is a ${account.platform} account, not ${target.platform}.`);
    if (account.status !== "active") errors.push(`Account needs to be reconnected (${account.lastError ?? account.status}).`);
    const adapter = getAdapter(account.platform);
    if (adapter) {
      const content = target.content ?? input.content;
      const options = target.platformSpecificData ?? {};
      if (!content.trim() && media.length === 0) errors.push("Post needs text or media.");
      if (adapter.requiresMedia && media.length === 0) errors.push(`${adapter.name} needs an image or video.`);
      if (!adapter.supportsText && media.length === 0) errors.push(`${adapter.name} does not support text-only posts.`);
      if (!adapter.supportsVideo && media.some((m) => m.type === "video")) errors.push(`${adapter.name} does not support video here.`);
      errors.push(...(adapter.validate?.({ content, media, options }) ?? []));
    }
    if (errors.length) problems.push({ accountId: target.accountId, platform: account.platform, errors });
  }
  if (problems.length) throw new PostValidationError("Some platforms cannot accept this post.", 422, problems);

  let scheduledFor = new Date();
  if (input.scheduledFor && !input.publishNow) {
    try {
      scheduledFor = parseScheduledFor(input.scheduledFor, input.timezone);
    } catch (err) {
      throw new PostValidationError((err as Error).message, 400);
    }
  }

  const profileId = input.profileId ?? accounts[0]?.profileId ?? null;
  return db.post.create({
    data: {
      userId: user.id,
      profileId,
      content: input.content,
      mediaItems: media as unknown as object,
      scheduledFor,
      timezone: input.timezone,
      status: input.isDraft ? "draft" : "scheduled",
      source,
      externalId: input.externalId ?? null,
      idempotencyKey: idempotencyKey ?? null,
      targets: {
        create: input.platforms.map((t) => ({
          socialAccountId: t.accountId,
          platform: byId.get(t.accountId)!.platform,
          content: t.content ?? null,
          platformSpecificData: (t.platformSpecificData ?? undefined) as object | undefined,
        })),
      },
    },
    include: { targets: true },
  });
}

export async function cancelPost(userId: string, postId: string) {
  const post = await db.post.findFirst({ where: { id: postId, userId }, include: { targets: true } });
  if (!post) return null;
  if (["published", "partial", "failed", "cancelled"].includes(post.status)) {
    await db.post.delete({ where: { id: post.id } });
    return { deleted: true, cancelled: false };
  }
  await db.$transaction([
    db.postTarget.updateMany({ where: { postId: post.id, status: "pending" }, data: { status: "cancelled" } }),
    db.post.update({ where: { id: post.id }, data: { status: "cancelled" } }),
  ]);
  return { deleted: false, cancelled: true };
}

/** Put failed targets back in the queue. */
export async function retryPost(userId: string, postId: string) {
  const post = await db.post.findFirst({ where: { id: postId, userId } });
  if (!post) return null;
  const { count } = await db.postTarget.updateMany({
    where: { postId: post.id, status: "failed" },
    data: { status: "pending", error: null, attempts: 0, nextAttemptAt: null },
  });
  if (count > 0) await db.post.update({ where: { id: post.id }, data: { status: "scheduled", scheduledFor: new Date() } });
  return count;
}
