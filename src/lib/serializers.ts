import type { Post, PostTarget, Profile, SocialAccount, Webhook } from "@prisma/client";

export function serializeAccount(a: SocialAccount) {
  return {
    id: a.id,
    platform: a.platform,
    profileId: a.profileId,
    platformAccountId: a.platformAccountId,
    username: a.username,
    displayName: a.displayName,
    avatarUrl: a.avatarUrl,
    status: a.status,
    lastError: a.lastError,
    tokenExpiresAt: a.tokenExpiresAt,
    followers: a.followers,
    usesOwnApp: Boolean(a.platformAppId),
    metadata: publicMetadata(a.metadata),
    createdAt: a.createdAt,
  };
}

function publicMetadata(meta: unknown) {
  if (!meta || typeof meta !== "object") return {};
  const { ...rest } = meta as Record<string, unknown>;
  return rest;
}

export function serializeProfile(p: Profile & { _count?: { accounts: number } }) {
  return { id: p.id, name: p.name, description: p.description, accountCount: p._count?.accounts, createdAt: p.createdAt };
}

export function serializeTarget(t: PostTarget) {
  return {
    id: t.id,
    platform: t.platform,
    accountId: t.socialAccountId,
    status: t.status,
    platformPostId: t.platformPostId,
    platformPostUrl: t.platformPostUrl,
    error: t.error,
    attempts: t.attempts,
    publishedAt: t.publishedAt,
    metrics: t.metrics ?? null,
    metricsUpdatedAt: t.metricsUpdatedAt,
    ...(t.content ? { content: t.content } : {}),
    ...(t.platformSpecificData ? { platformSpecificData: t.platformSpecificData } : {}),
  };
}

export function serializePost(p: Post & { targets: PostTarget[] }) {
  return {
    id: p.id,
    status: p.status,
    content: p.content,
    mediaItems: p.mediaItems,
    scheduledFor: p.scheduledFor,
    timezone: p.timezone,
    profileId: p.profileId,
    externalId: p.externalId,
    source: p.source,
    publishedAt: p.publishedAt,
    createdAt: p.createdAt,
    platforms: p.targets.map(serializeTarget),
  };
}

export function serializeWebhook(w: Webhook, includeSecret = false) {
  return {
    id: w.id,
    url: w.url,
    events: w.events,
    active: w.active,
    lastStatus: w.lastStatus,
    lastError: w.lastError,
    lastDelivered: w.lastDelivered,
    createdAt: w.createdAt,
    ...(includeSecret ? { secret: w.secret } : {}),
  };
}
