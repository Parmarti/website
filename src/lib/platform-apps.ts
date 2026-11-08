import { db } from "./db";
import { decrypt } from "./crypto";
import type { AppCredentials, PlatformId } from "./platforms/types";

/** Env var prefix for the shared developer app of each OAuth platform. */
export function envPrefix(platform: PlatformId): string {
  return platform.toUpperCase();
}

export function sharedAppCredentials(platform: PlatformId): AppCredentials | null {
  const prefix = envPrefix(platform);
  const clientId = process.env[`${prefix}_CLIENT_ID`];
  const clientSecret = process.env[`${prefix}_CLIENT_SECRET`];
  return clientId && clientSecret ? { clientId, clientSecret } : null;
}

/** The customer's own app if they configured one, otherwise the shared app from env. */
export async function resolveAppCredentials(
  userId: string,
  platform: PlatformId,
): Promise<{ app: AppCredentials; platformAppId: string | null } | null> {
  const own = await db.platformApp.findUnique({ where: { userId_platform: { userId, platform } } });
  if (own) return { app: { clientId: own.clientId, clientSecret: decrypt(own.clientSecret) }, platformAppId: own.id };
  const shared = sharedAppCredentials(platform);
  return shared ? { app: shared, platformAppId: null } : null;
}

export async function appCredentialsForAccount(account: { platform: string; platformAppId: string | null }): Promise<AppCredentials | null> {
  if (account.platformAppId) {
    const own = await db.platformApp.findUnique({ where: { id: account.platformAppId } });
    if (own) return { clientId: own.clientId, clientSecret: decrypt(own.clientSecret) };
  }
  return sharedAppCredentials(account.platform as PlatformId);
}
