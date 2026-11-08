import type { OAuthState } from "@prisma/client";
import { db } from "./db";
import { appUrl } from "./env";
import { decrypt, encrypt } from "./crypto";
import { sharedAppCredentials } from "./platform-apps";
import type { AppCredentials, ConnectedAccount, PlatformId } from "./platforms/types";

/** Where to send the user after connecting, with result params appended. */
export function connectReturnUrl(state: Pick<OAuthState, "redirectUrl">, params: Record<string, string | undefined>): string {
  const url = new URL(state.redirectUrl || `${appUrl()}/dashboard/accounts`);
  for (const [k, v] of Object.entries(params)) if (v) url.searchParams.set(k, v);
  return url.toString();
}

export async function appForState(state: OAuthState): Promise<AppCredentials | null> {
  if (state.platformAppId) {
    const own = await db.platformApp.findUnique({ where: { id: state.platformAppId } });
    if (own) return { clientId: own.clientId, clientSecret: decrypt(own.clientSecret) };
  }
  return sharedAppCredentials(state.platform as PlatformId);
}

/** Keep accounts from a multi-account login until the user picks which ones to add. */
export async function storePendingAccounts(stateId: string, accounts: ConnectedAccount[]) {
  await db.oAuthState.update({
    where: { id: stateId },
    data: { pendingAccounts: encrypt(JSON.stringify(accounts)), expiresAt: new Date(Date.now() + 30 * 60_000) },
  });
}

export function readPendingAccounts(state: Pick<OAuthState, "pendingAccounts">): ConnectedAccount[] {
  if (!state.pendingAccounts) return [];
  const raw = JSON.parse(decrypt(state.pendingAccounts)) as ConnectedAccount[];
  return raw.map((a) => ({ ...a, token: { ...a.token, expiresAt: a.token.expiresAt ? new Date(a.token.expiresAt) : null } }));
}
