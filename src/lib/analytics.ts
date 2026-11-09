import type { Prisma } from "@prisma/client";
import { db } from "./db";
import { getAdapter, type PostMetrics, type AccountMetrics } from "./platforms";
import { PlatformError, chunk } from "./platforms/http";
import { buildPublishContext, markAccountExpired } from "./accounts";
import { hit } from "./rate-limit";

export const METRIC_KEYS = ["impressions", "reach", "views", "likes", "comments", "shares", "saves", "clicks", "quotes"] as const;
export type MetricKey = (typeof METRIC_KEYS)[number];

/* ---------- Math ---------- */

/** Engagements = likes + comments + shares + saves + quotes. Clicks and views are not engagements. */
export function engagementsOf(m: PostMetrics | null | undefined): number {
  if (!m) return 0;
  return (m.likes ?? 0) + (m.comments ?? 0) + (m.shares ?? 0) + (m.saves ?? 0) + (m.quotes ?? 0);
}

/** The audience size we divide by: impressions, else views, else reach. */
export function audienceOf(m: PostMetrics | null | undefined): number | null {
  if (!m) return null;
  return m.impressions ?? m.views ?? m.reach ?? null;
}

export function rate(engagements: number, audience: number | null): number | null {
  return audience && audience > 0 ? Math.round((engagements / audience) * 10_000) / 10_000 : null;
}

function cleanMetrics(m: PostMetrics): PostMetrics {
  const out: PostMetrics = {};
  for (const k of METRIC_KEYS) {
    const v = m[k];
    if (typeof v === "number" && Number.isFinite(v)) out[k] = v;
  }
  return out;
}

/* ---------- Collection schedule ---------- */

const MIN = 60_000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;

/** Fresh posts change fast, old posts barely change: check often at first, then back off, then stop after 90 days. */
export function nextMetricsAt(publishedAt: Date | null, now = new Date()): Date | null {
  if (!publishedAt) return null;
  const age = now.getTime() - publishedAt.getTime();
  const wait = age < 6 * HOUR ? 30 * MIN : age < 2 * DAY ? 2 * HOUR : age < 7 * DAY ? 12 * HOUR : age < 30 * DAY ? DAY : age < 90 * DAY ? 7 * DAY : null;
  return wait === null ? null : new Date(now.getTime() + wait);
}

export function firstMetricsAt(platform: string, publishedAt = new Date()): Date | null {
  return getAdapter(platform)?.analytics?.fetchPostMetrics ? new Date(publishedAt.getTime() + 20 * MIN) : null;
}

/* ---------- Collection job ---------- */

async function claimDueTargets(limit: number): Promise<string[]> {
  const rows = await db.$queryRaw<{ id: string }[]>`
    UPDATE "PostTarget" SET "metricsNextAt" = now() + interval '15 minutes'
    WHERE id IN (
      SELECT id FROM "PostTarget"
      WHERE status = 'published' AND "platformPostId" IS NOT NULL AND "metricsNextAt" <= now()
      ORDER BY "metricsNextAt" ASC
      LIMIT ${limit}
      FOR UPDATE SKIP LOCKED
    )
    RETURNING id`;
  return rows.map((r) => r.id);
}

async function claimDueAccounts(limit: number): Promise<string[]> {
  const rows = await db.$queryRaw<{ id: string }[]>`
    UPDATE "SocialAccount" SET "metricsNextAt" = now() + interval '15 minutes'
    WHERE id IN (
      SELECT id FROM "SocialAccount"
      WHERE status = 'active' AND "metricsNextAt" <= now()
      ORDER BY "metricsNextAt" ASC
      LIMIT ${limit}
      FOR UPDATE SKIP LOCKED
    )
    RETURNING id`;
  return rows.map((r) => r.id);
}

function failureDelay(err: unknown) {
  return err instanceof PlatformError && err.opts.retryable ? 30 * MIN : DAY;
}

export async function collectPostMetrics(limit = 100): Promise<number> {
  const ids = await claimDueTargets(limit);
  if (ids.length === 0) return 0;
  const targets = await db.postTarget.findMany({ where: { id: { in: ids } }, include: { socialAccount: true } });

  const byAccount = new Map<string, typeof targets>();
  for (const t of targets) {
    const support = getAdapter(t.platform)?.analytics;
    if (!t.socialAccount || !support?.fetchPostMetrics) {
      await db.postTarget.update({ where: { id: t.id }, data: { metricsNextAt: null } });
      continue;
    }
    const list = byAccount.get(t.socialAccount.id) ?? [];
    list.push(t);
    byAccount.set(t.socialAccount.id, list);
  }

  let updated = 0;
  for (const list of byAccount.values()) {
    const account = list[0].socialAccount!;
    const support = getAdapter(account.platform)!.analytics!;
    if (account.status !== "active") {
      await db.postTarget.updateMany({
        where: { id: { in: list.map((t) => t.id) } },
        data: { metricsError: "The account needs to be reconnected.", metricsNextAt: new Date(Date.now() + DAY) },
      });
      continue;
    }
    let ctx;
    try {
      ctx = await buildPublishContext(account, { content: "", media: [], options: {} });
    } catch (err) {
      if (err instanceof PlatformError && err.opts.auth) await markAccountExpired(account, err.message);
      await db.postTarget.updateMany({
        where: { id: { in: list.map((t) => t.id) } },
        data: { metricsError: (err as Error).message, metricsNextAt: new Date(Date.now() + failureDelay(err)) },
      });
      continue;
    }

    for (const batch of chunk(list, support.postBatchSize ?? 1)) {
      try {
        const result = await support.fetchPostMetrics!(ctx, batch.map((t) => t.platformPostId!));
        const now = new Date();
        for (const t of batch) {
          const m = result[t.platformPostId!];
          if (!m) {
            await db.postTarget.update({
              where: { id: t.id },
              data: { metricsError: "The network did not return this post. It may have been deleted.", metricsNextAt: nextMetricsAt(t.publishedAt, now) },
            });
            continue;
          }
          const metrics = cleanMetrics(m) as Prisma.InputJsonObject;
          await db.$transaction([
            db.postTarget.update({
              where: { id: t.id },
              data: { metrics, metricsUpdatedAt: now, metricsError: null, metricsNextAt: nextMetricsAt(t.publishedAt, now) },
            }),
            db.metricSnapshot.create({ data: { targetId: t.id, capturedAt: now, metrics } }),
          ]);
          updated++;
        }
      } catch (err) {
        if (err instanceof PlatformError && err.opts.auth) await markAccountExpired(account, err.message);
        else if (!(err instanceof PlatformError)) console.error("[analytics] post metrics failed", err);
        await db.postTarget.updateMany({
          where: { id: { in: batch.map((t) => t.id) } },
          data: { metricsError: (err as Error).message.slice(0, 500), metricsNextAt: new Date(Date.now() + failureDelay(err)) },
        });
      }
    }
  }
  return updated;
}

function utcDay(d = new Date()) {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
}

export async function collectAccountMetrics(limit = 50): Promise<number> {
  const ids = await claimDueAccounts(limit);
  let updated = 0;
  for (const id of ids) {
    const account = await db.socialAccount.findUnique({ where: { id } });
    if (!account) continue;
    const fetch = getAdapter(account.platform)?.analytics?.fetchAccountMetrics;
    if (!fetch) {
      await db.socialAccount.update({ where: { id }, data: { metricsNextAt: null } });
      continue;
    }
    try {
      const ctx = await buildPublishContext(account, { content: "", media: [], options: {} });
      const m: AccountMetrics = await fetch(ctx);
      const date = utcDay();
      const data = { followers: m.followers ?? null, following: m.following ?? null, posts: m.posts ?? null };
      await db.$transaction([
        db.accountSnapshot.upsert({ where: { accountId_date: { accountId: id, date } }, create: { accountId: id, date, ...data }, update: data }),
        db.socialAccount.update({
          where: { id },
          data: { followers: data.followers, metricsError: null, metricsNextAt: new Date(Date.now() + 12 * HOUR) },
        }),
      ]);
      updated++;
    } catch (err) {
      if (err instanceof PlatformError && err.opts.auth) await markAccountExpired(account, err.message);
      else if (!(err instanceof PlatformError)) console.error("[analytics] account metrics failed", err);
      await db.socialAccount.update({
        where: { id },
        data: { metricsError: (err as Error).message.slice(0, 500), metricsNextAt: new Date(Date.now() + failureDelay(err)) },
      });
    }
  }
  return updated;
}

let collecting = false;

export async function collectAnalytics() {
  if (collecting) return { posts: 0, accounts: 0, skipped: true };
  collecting = true;
  try {
    const posts = await collectPostMetrics();
    const accounts = await collectAccountMetrics();
    return { posts, accounts, skipped: false };
  } finally {
    collecting = false;
  }
}

/** Ask for fresh numbers now (at most once per 5 minutes per target). */
export async function requestRefresh(userId: string, postId: string): Promise<{ queued: number; reason?: string } | null> {
  const post = await db.post.findFirst({ where: { id: postId, userId }, select: { id: true } });
  if (!post) return null;
  const published = await db.postTarget.count({ where: { postId, status: "published", platformPostId: { not: null } } });
  if (published === 0) return { queued: 0, reason: "not_published" };
  // One refresh per post every 5 minutes, whatever state the collection is in.
  if (!hit(`refresh:${postId}`, 1, 5 * MIN).ok) return { queued: 0, reason: "refreshed_recently" };
  const now = new Date();
  const { count } = await db.postTarget.updateMany({
    where: {
      postId,
      status: "published",
      platformPostId: { not: null },
      AND: [
        { OR: [{ metricsUpdatedAt: null }, { metricsUpdatedAt: { lt: new Date(now.getTime() - 5 * MIN) } }] },
        // Skip targets that are already waiting for collection (NULL means no collection is scheduled).
        { OR: [{ metricsNextAt: null }, { metricsNextAt: { gt: now } }] },
      ],
    },
    data: { metricsNextAt: now },
  });
  if (count > 0) return { queued: count };
  const waiting = await db.postTarget.count({ where: { postId, status: "published", metricsNextAt: { lte: now } } });
  return { queued: 0, reason: waiting > 0 ? "already_queued" : "refreshed_recently" };
}

/* ---------- Queries ---------- */

export interface AnalyticsFilters {
  from: Date;
  to: Date;
  profileId?: string | null;
  platform?: string | null;
  accountId?: string | null;
  timezone?: string;
}

export function parseRange(params: URLSearchParams | Record<string, string | undefined>, maxDays = 366): { from: Date; to: Date } {
  const get = (k: string) => (params instanceof URLSearchParams ? params.get(k) : params[k]) ?? undefined;
  const now = new Date();
  const days = Number(get("days"));
  let to = get("to") ? new Date(get("to")!) : now;
  if (Number.isNaN(to.getTime())) to = now;
  if (/^\d{4}-\d{2}-\d{2}$/.test(get("to") ?? "")) to = new Date(to.getTime() + DAY - 1);
  let from = get("from") ? new Date(get("from")!) : new Date(to.getTime() - (Number.isFinite(days) && days > 0 ? days : 30) * DAY);
  if (Number.isNaN(from.getTime())) from = new Date(to.getTime() - 30 * DAY);
  if (to.getTime() - from.getTime() > maxDays * DAY) from = new Date(to.getTime() - maxDays * DAY);
  return { from, to };
}

/** audience = per post impressions, else views, else reach, summed (the denominator of engagementRate). */
type Totals = { posts: number; engagements: number; engagementRate: number | null; audience: number | null } & Record<MetricKey, number | null>;

function emptyTotals(): Totals {
  const t = { posts: 0, engagements: 0, engagementRate: null, audience: null } as Totals;
  for (const k of METRIC_KEYS) t[k] = null;
  return t;
}

function addTo(t: Totals & { _aud?: number; _engWithAud?: number }, m: PostMetrics | null) {
  t.posts++;
  if (!m) return;
  for (const k of METRIC_KEYS) if (typeof m[k] === "number") t[k] = (t[k] ?? 0) + (m[k] as number);
  const eng = engagementsOf(m);
  t.engagements += eng;
  const aud = audienceOf(m);
  if (aud) {
    t._aud = (t._aud ?? 0) + aud;
    t._engWithAud = (t._engWithAud ?? 0) + eng;
  }
}

function finish(t: Totals & { _aud?: number; _engWithAud?: number }): Totals {
  const { _aud, _engWithAud, ...rest } = t;
  return { ...rest, audience: _aud ?? null, engagementRate: rate(_engWithAud ?? 0, _aud ?? null) };
}

function dayKey(d: Date, timeZone: string) {
  return new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).format(d);
}

export async function getOverview(userId: string, f: AnalyticsFilters) {
  const timeZone = f.timezone || "UTC";
  const accountWhere = {
    userId,
    ...(f.profileId ? { profileId: f.profileId } : {}),
    ...(f.platform ? { platform: f.platform } : {}),
    ...(f.accountId ? { id: f.accountId } : {}),
  };
  const targets = await db.postTarget.findMany({
    where: {
      status: "published",
      publishedAt: { gte: f.from, lte: f.to },
      post: { userId },
      socialAccount: accountWhere,
    },
    select: {
      id: true,
      platform: true,
      socialAccountId: true,
      platformPostUrl: true,
      publishedAt: true,
      metrics: true,
      metricsUpdatedAt: true,
      post: { select: { id: true, content: true } },
      content: true,
    },
    orderBy: { publishedAt: "asc" },
  });

  const totals = emptyTotals();
  const byPlatform = new Map<string, Totals>();
  const daily = new Map<string, { date: string; posts: number; engagements: number; impressions: number | null; views: number | null }>();
  for (let d = new Date(f.from); d <= f.to; d = new Date(d.getTime() + DAY)) {
    const key = dayKey(d, timeZone);
    daily.set(key, { date: key, posts: 0, engagements: 0, impressions: null, views: null });
  }
  const lastKey = dayKey(f.to, timeZone);
  if (!daily.has(lastKey)) daily.set(lastKey, { date: lastKey, posts: 0, engagements: 0, impressions: null, views: null });

  let withMetrics = 0;
  for (const t of targets) {
    const m = (t.metrics as PostMetrics | null) ?? null;
    if (m) withMetrics++;
    addTo(totals, m);
    const p = byPlatform.get(t.platform) ?? emptyTotals();
    addTo(p, m);
    byPlatform.set(t.platform, p);
    const day = daily.get(dayKey(t.publishedAt!, timeZone));
    if (day) {
      day.posts++;
      day.engagements += engagementsOf(m);
      if (typeof m?.impressions === "number") day.impressions = (day.impressions ?? 0) + m.impressions;
      if (typeof m?.views === "number") day.views = (day.views ?? 0) + m.views;
    }
  }

  const topPosts = targets
    .filter((t) => t.metrics)
    .map((t) => {
      const m = t.metrics as PostMetrics;
      const engagements = engagementsOf(m);
      return {
        postId: t.post.id,
        targetId: t.id,
        platform: t.platform,
        accountId: t.socialAccountId,
        content: (t.content ?? t.post.content).slice(0, 280),
        url: t.platformPostUrl,
        publishedAt: t.publishedAt,
        metrics: m,
        engagements,
        engagementRate: rate(engagements, audienceOf(m)),
      };
    })
    .sort((a, b) => b.engagements - a.engagements || (audienceOf(b.metrics) ?? 0) - (audienceOf(a.metrics) ?? 0))
    .slice(0, 10);

  const accounts = await db.socialAccount.findMany({
    where: accountWhere,
    select: {
      id: true,
      platform: true,
      displayName: true,
      username: true,
      followers: true,
      metricsError: true,
      snapshots: { where: { date: { gte: utcDay(new Date(f.from.getTime() - DAY)), lte: f.to } }, orderBy: { date: "asc" } },
    },
    orderBy: { createdAt: "asc" },
  });

  return {
    range: { from: f.from, to: f.to, timezone: timeZone },
    totals: finish(totals),
    coverage: { posts: targets.length, withMetrics },
    byPlatform: [...byPlatform.entries()].map(([platform, t]) => ({ platform, ...finish(t) })).sort((a, b) => b.engagements - a.engagements),
    daily: [...daily.values()],
    topPosts,
    accounts: accounts.map((a) => {
      const series = a.snapshots.filter((s) => s.followers !== null).map((s) => ({ date: s.date.toISOString().slice(0, 10), followers: s.followers! }));
      return {
        accountId: a.id,
        platform: a.platform,
        name: a.displayName || a.username,
        followers: a.followers,
        followersChange: series.length >= 2 ? series[series.length - 1].followers - series[0].followers : null,
        series,
        metricsError: a.metricsError,
      };
    }),
  };
}

export async function getPostAnalytics(userId: string, postId: string) {
  const post = await db.post.findFirst({
    where: { id: postId, userId },
    include: { targets: { include: { snapshots: { orderBy: { capturedAt: "asc" }, take: 200 } } } },
  });
  if (!post) return null;
  const totals = emptyTotals();
  const platforms = post.targets.map((t) => {
    const m = (t.metrics as PostMetrics | null) ?? null;
    if (t.status === "published") addTo(totals, m);
    const engagements = engagementsOf(m);
    return {
      targetId: t.id,
      platform: t.platform,
      accountId: t.socialAccountId,
      status: t.status,
      url: t.platformPostUrl,
      publishedAt: t.publishedAt,
      metrics: m,
      engagements,
      engagementRate: rate(engagements, audienceOf(m)),
      metricsUpdatedAt: t.metricsUpdatedAt,
      nextUpdateAt: t.metricsNextAt,
      metricsError: t.metricsError,
      supported: Boolean(getAdapter(t.platform)?.analytics?.fetchPostMetrics),
      history: t.snapshots.map((s) => ({ capturedAt: s.capturedAt, ...(s.metrics as PostMetrics) })),
    };
  });
  return { postId: post.id, content: post.content, publishedAt: post.publishedAt, totals: finish(totals), platforms };
}

export async function getAccountAnalytics(userId: string, accountId: string, range: { from: Date; to: Date }) {
  const account = await db.socialAccount.findFirst({
    where: { id: accountId, userId },
    include: { snapshots: { where: { date: { gte: utcDay(new Date(range.from.getTime() - DAY)), lte: range.to } }, orderBy: { date: "asc" } } },
  });
  if (!account) return null;
  const series = account.snapshots.map((s) => ({ date: s.date.toISOString().slice(0, 10), followers: s.followers, following: s.following, posts: s.posts }));
  const withFollowers = series.filter((s) => s.followers !== null);
  return {
    accountId: account.id,
    platform: account.platform,
    name: account.displayName || account.username,
    followers: account.followers,
    followersChange: withFollowers.length >= 2 ? withFollowers[withFollowers.length - 1].followers! - withFollowers[0].followers! : null,
    supported: Boolean(getAdapter(account.platform)?.analytics?.fetchAccountMetrics),
    metricsError: account.metricsError,
    series,
  };
}
