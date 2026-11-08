import { db } from "./db";
import { getAdapter, type MediaItem } from "./platforms";
import { PlatformError } from "./platforms/http";
import { buildPublishContext, markAccountExpired, refreshExpiringTokens } from "./accounts";
import { emitEvent } from "./webhooks";
import { serializePost } from "./serializers";
import { collectAnalytics, firstMetricsAt } from "./analytics";

const MAX_ATTEMPTS = 3;
const BACKOFF_MINUTES = [1, 5, 15];
const STUCK_AFTER_MINUTES = 20;
const CONCURRENCY = 5;

/** Claim due targets atomically so several workers never publish the same target twice. */
async function claimDueTargets(limit: number): Promise<string[]> {
  const rows = await db.$queryRaw<{ id: string }[]>`
    UPDATE "PostTarget" SET status = 'publishing', attempts = attempts + 1, "updatedAt" = now()
    WHERE id IN (
      SELECT t.id FROM "PostTarget" t
      JOIN "Post" p ON p.id = t."postId"
      WHERE t.status = 'pending'
        AND p.status IN ('scheduled', 'publishing')
        AND p."scheduledFor" <= now()
        AND (t."nextAttemptAt" IS NULL OR t."nextAttemptAt" <= now())
      ORDER BY p."scheduledFor" ASC
      LIMIT ${limit}
      FOR UPDATE OF t SKIP LOCKED
    )
    RETURNING id`;
  return rows.map((r) => r.id);
}

/** A worker that died mid-publish leaves targets in 'publishing'. We cannot know if the post went out, so fail them. */
async function failStuckTargets() {
  const stuck = await db.postTarget.findMany({
    where: { status: "publishing", updatedAt: { lt: new Date(Date.now() - STUCK_AFTER_MINUTES * 60_000) } },
    select: { id: true, postId: true },
  });
  for (const t of stuck) {
    await db.postTarget.update({
      where: { id: t.id },
      data: { status: "failed", error: "Publishing was interrupted. Check the platform before you retry." },
    });
    await finalizePost(t.postId);
  }
}

async function publishTarget(targetId: string) {
  const target = await db.postTarget.findUnique({ where: { id: targetId }, include: { post: true, socialAccount: true } });
  if (!target) return;
  const { post, socialAccount: account } = target;

  try {
    if (!account) throw new PlatformError("The account for this post was disconnected.");
    const adapter = getAdapter(account.platform);
    if (!adapter) throw new PlatformError(`Unknown platform ${account.platform}`);
    if (account.status !== "active") throw new PlatformError(`Account needs to be reconnected: ${account.lastError ?? account.status}`);

    const ctx = await buildPublishContext(account, {
      content: target.content ?? post.content,
      media: post.mediaItems as unknown as MediaItem[],
      options: (target.platformSpecificData as Record<string, unknown>) ?? {},
    });
    const result = await adapter.publish(ctx);
    await db.postTarget.update({
      where: { id: target.id },
      data: {
        status: "published",
        platformPostId: result.platformPostId,
        platformPostUrl: result.url ?? null,
        publishedAt: new Date(),
        error: null,
        nextAttemptAt: null,
        metricsNextAt: firstMetricsAt(account.platform),
      },
    });
    if (account.lastError) await db.socialAccount.update({ where: { id: account.id }, data: { lastError: null } });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const pe = err instanceof PlatformError ? err : null;
    if (!pe) console.error(`[publisher] unexpected error for target ${target.id}`, err);
    if (pe?.opts.auth && account) await markAccountExpired(account, message);
    const retry = Boolean(pe?.opts.retryable) && target.attempts < MAX_ATTEMPTS;
    await db.postTarget.update({
      where: { id: target.id },
      data: retry
        ? { status: "pending", error: message, nextAttemptAt: new Date(Date.now() + BACKOFF_MINUTES[target.attempts - 1] * 60_000) }
        : { status: "failed", error: message, nextAttemptAt: null },
    });
  }
  await finalizePost(post.id);
}

/** When every target is done, set the post status once and send the webhook. */
async function finalizePost(postId: string) {
  const targets = await db.postTarget.findMany({ where: { postId } });
  const live = targets.filter((t) => t.status !== "cancelled");
  if (live.some((t) => t.status === "pending" || t.status === "publishing")) {
    await db.post.updateMany({ where: { id: postId, status: "scheduled" }, data: { status: "publishing" } });
    return;
  }
  const published = live.filter((t) => t.status === "published").length;
  const status = published === live.length ? "published" : published === 0 ? "failed" : "partial";
  const { count } = await db.post.updateMany({
    where: { id: postId, status: { in: ["scheduled", "publishing"] } },
    data: { status, publishedAt: published ? new Date() : null },
  });
  if (count === 1) {
    const post = await db.post.findUniqueOrThrow({ where: { id: postId }, include: { targets: true } });
    await emitEvent(post.userId, `post.${status}` as "post.published" | "post.partial" | "post.failed", serializePost(post));
  }
}

let running = false;

/** Publish everything that is due. Safe to call often and from several processes. */
export async function processDuePosts(opts: { maxBatches?: number } = {}) {
  if (running) return { processed: 0, skipped: true };
  running = true;
  let processed = 0;
  try {
    await failStuckTargets();
    for (let batch = 0; batch < (opts.maxBatches ?? 10); batch++) {
      const ids = await claimDueTargets(CONCURRENCY * 4);
      if (ids.length === 0) break;
      for (let i = 0; i < ids.length; i += CONCURRENCY) {
        await Promise.all(ids.slice(i, i + CONCURRENCY).map(publishTarget));
      }
      processed += ids.length;
    }
  } finally {
    running = false;
  }
  return { processed, skipped: false };
}

let lastRefresh = 0;
let lastAnalytics = 0;

/** One scheduler tick: publish due posts, collect metrics every minute, refresh tokens every 30 minutes. */
export async function schedulerTick() {
  const result = await processDuePosts();
  if (Date.now() - lastAnalytics > 60_000) {
    lastAnalytics = Date.now();
    await collectAnalytics().catch((err) => console.error("[scheduler] analytics failed", err));
  }
  if (Date.now() - lastRefresh > 30 * 60_000) {
    lastRefresh = Date.now();
    await refreshExpiringTokens().catch((err) => console.error("[scheduler] token refresh failed", err));
  }
  return result;
}
