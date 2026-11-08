import type { SocialAccount } from "@prisma/client";
import { db } from "./db";
import { decryptOptional, encrypt, encryptOptional, randomToken, pkcePair } from "./crypto";
import { getPlan } from "./plans";
import { getAdapter, type ConnectedAccount, type ConnectedIdentity, type PlatformId, type PublishContext } from "./platforms";
import { PlatformError } from "./platforms/http";
import { appCredentialsForAccount, resolveAppCredentials } from "./platform-apps";
import { emitEvent } from "./webhooks";
import { serializeAccount } from "./serializers";
import { appUrl } from "./env";

export class LimitError extends Error {}

export async function ensureDefaultProfile(userId: string) {
  const existing = await db.profile.findFirst({ where: { userId }, orderBy: { createdAt: "asc" } });
  return existing ?? db.profile.create({ data: { userId, name: "Default" } });
}

async function assertAccountCapacity(userId: string, plan: string, adding: number) {
  const limit = getPlan(plan).accounts;
  const current = await db.socialAccount.count({ where: { userId } });
  if (current + adding > limit) {
    throw new LimitError(`Your ${getPlan(plan).name} plan allows ${limit} connected accounts. Upgrade to connect more.`);
  }
}

/** Create the OAuth state row and return the hosted connect URL on our domain. */
export async function startConnect(input: {
  userId: string;
  platform: PlatformId;
  profileId?: string | null;
  redirectUrl?: string | null;
}): Promise<string> {
  const adapter = getAdapter(input.platform);
  if (!adapter) throw new Error(`Unknown platform ${input.platform}`);
  const profile = input.profileId
    ? await db.profile.findFirst({ where: { id: input.profileId, userId: input.userId } })
    : await ensureDefaultProfile(input.userId);
  if (!profile) throw new Error("Profile not found");

  let platformAppId: string | null = null;
  let codeVerifier: string | null = null;
  if (adapter.kind === "oauth") {
    const creds = await resolveAppCredentials(input.userId, input.platform);
    if (!creds) throw new Error(`${adapter.name} is not configured yet. Add your own ${adapter.name} app credentials in the dashboard.`);
    platformAppId = creds.platformAppId;
    if (adapter.usesPkce) codeVerifier = pkcePair().verifier;
  }

  const state = randomToken(24);
  await db.oAuthState.create({
    data: {
      state,
      userId: input.userId,
      profileId: profile.id,
      platform: input.platform,
      codeVerifier,
      redirectUrl: input.redirectUrl ?? null,
      platformAppId,
      expiresAt: new Date(Date.now() + 30 * 60_000),
    },
  });
  return `${appUrl()}/connect/${input.platform}?state=${state}`;
}

export function oauthRedirectUri(platform: PlatformId) {
  return `${appUrl()}/api/connect/${platform}/callback`;
}

export async function loadConnectState(state: string | null | undefined, platform: string) {
  if (!state) return null;
  const row = await db.oAuthState.findUnique({ where: { state } });
  if (!row || row.platform !== platform || row.expiresAt < new Date()) return null;
  return row;
}

/** Store accounts returned by an OAuth grant or a credential check. */
export async function saveAccounts(input: {
  userId: string;
  profileId: string;
  platform: PlatformId;
  platformAppId: string | null;
  accounts: (ConnectedAccount | (ConnectedIdentity & { credentials: Record<string, string> }))[];
}): Promise<SocialAccount[]> {
  const user = await db.user.findUniqueOrThrow({ where: { id: input.userId } });
  const existing = await db.socialAccount.findMany({
    where: { profileId: input.profileId, platform: input.platform, platformAccountId: { in: input.accounts.map((a) => a.platformAccountId) } },
    select: { platformAccountId: true },
  });
  const existingIds = new Set(existing.map((e) => e.platformAccountId));
  await assertAccountCapacity(user.id, user.plan, input.accounts.filter((a) => !existingIds.has(a.platformAccountId)).length);

  const saved: SocialAccount[] = [];
  for (const acc of input.accounts) {
    const tokenFields =
      "token" in acc
        ? {
            accessToken: encrypt(acc.token.accessToken),
            refreshToken: encryptOptional(acc.token.refreshToken),
            tokenExpiresAt: acc.token.expiresAt ?? null,
            credentials: null,
          }
        : { accessToken: null, refreshToken: null, tokenExpiresAt: null, credentials: encrypt(JSON.stringify(acc.credentials)) };
    const data = {
      username: acc.username ?? null,
      displayName: acc.displayName ?? null,
      avatarUrl: acc.avatarUrl ?? null,
      metadata: (acc.metadata ?? {}) as object,
      status: "active",
      lastError: null,
      platformAppId: input.platformAppId,
      metricsNextAt: new Date(),
      ...tokenFields,
    };
    const row = await db.socialAccount.upsert({
      where: {
        profileId_platform_platformAccountId: {
          profileId: input.profileId,
          platform: input.platform,
          platformAccountId: acc.platformAccountId,
        },
      },
      create: { userId: input.userId, profileId: input.profileId, platform: input.platform, platformAccountId: acc.platformAccountId, ...data },
      update: data,
    });
    saved.push(row);
  }
  for (const row of saved) await emitEvent(input.userId, "account.connected", serializeAccount(row));
  return saved;
}

export async function disconnectAccount(userId: string, accountId: string) {
  const account = await db.socialAccount.findFirst({ where: { id: accountId, userId } });
  if (!account) return false;
  await db.socialAccount.delete({ where: { id: account.id } });
  await emitEvent(userId, "account.disconnected", serializeAccount(account));
  return true;
}

export async function markAccountExpired(account: SocialAccount, message: string) {
  if (account.status === "expired") return;
  const updated = await db.socialAccount.update({ where: { id: account.id }, data: { status: "expired", lastError: message } });
  await emitEvent(account.userId, "account.expired", serializeAccount(updated));
}

/** Decrypt secrets and refresh OAuth tokens that are about to expire. */
export async function buildPublishContext(
  account: SocialAccount,
  post: { content: string; media: PublishContext["media"]; options: Record<string, unknown> },
): Promise<PublishContext> {
  const adapter = getAdapter(account.platform);
  if (!adapter) throw new PlatformError(`Unknown platform ${account.platform}`);
  const app = adapter.kind === "oauth" ? await appCredentialsForAccount(account) : null;
  let accessToken = decryptOptional(account.accessToken);
  const refreshToken = decryptOptional(account.refreshToken);

  const expiringSoon = account.tokenExpiresAt && account.tokenExpiresAt.getTime() < Date.now() + 5 * 60_000;
  if (adapter.kind === "oauth" && expiringSoon && accessToken) {
    if (!adapter.refresh || !app) throw new PlatformError(`${adapter.name} access expired. Reconnect the account.`, { auth: true });
    const fresh = await adapter.refresh({ app, refreshToken, accessToken });
    accessToken = fresh.accessToken;
    await db.socialAccount.update({
      where: { id: account.id },
      data: {
        accessToken: encrypt(fresh.accessToken),
        refreshToken: encryptOptional(fresh.refreshToken ?? refreshToken),
        tokenExpiresAt: fresh.expiresAt ?? null,
      },
    });
  }

  const credentialsJson = decryptOptional(account.credentials);
  return {
    account: {
      id: account.id,
      platformAccountId: account.platformAccountId,
      username: account.username,
      metadata: (account.metadata as Record<string, unknown>) ?? {},
    },
    accessToken,
    credentials: credentialsJson ? JSON.parse(credentialsJson) : null,
    app,
    content: post.content,
    media: post.media,
    options: post.options,
  };
}

/** Refresh tokens ahead of time so long-lived scheduled posts do not fail. */
export async function refreshExpiringTokens(limit = 25) {
  const soon = new Date(Date.now() + 3 * 86400_000);
  const accounts = await db.socialAccount.findMany({
    where: {
      status: "active",
      tokenExpiresAt: { lt: soon },
      // Meta long-lived tokens refresh with the access token itself; others need a refresh token.
      OR: [{ refreshToken: { not: null } }, { platform: { in: ["instagram", "threads"] } }],
    },
    take: limit,
    orderBy: { tokenExpiresAt: "asc" },
  });
  for (const account of accounts) {
    const adapter = getAdapter(account.platform);
    if (adapter?.kind !== "oauth" || !adapter.refresh) continue;
    try {
      const app = await appCredentialsForAccount(account);
      if (!app) continue;
      const fresh = await adapter.refresh({ app, refreshToken: decryptOptional(account.refreshToken), accessToken: decryptOptional(account.accessToken) ?? "" });
      await db.socialAccount.update({
        where: { id: account.id },
        data: {
          accessToken: encrypt(fresh.accessToken),
          refreshToken: encryptOptional(fresh.refreshToken ?? decryptOptional(account.refreshToken)),
          tokenExpiresAt: fresh.expiresAt ?? null,
        },
      });
    } catch (err) {
      const alreadyExpired = account.tokenExpiresAt && account.tokenExpiresAt < new Date();
      if (err instanceof PlatformError && err.opts.auth && alreadyExpired) await markAccountExpired(account, err.message);
      else console.warn(`[tokens] refresh failed for ${account.id}:`, (err as Error).message);
    }
  }
}
