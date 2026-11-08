import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { LimitError, loadConnectState, oauthRedirectUri, saveAccounts } from "@/lib/accounts";
import { appForState, connectReturnUrl, storePendingAccounts } from "@/lib/connect";
import { getAdapter, isPlatformId } from "@/lib/platforms";
import { PlatformError } from "@/lib/platforms/http";
import { appUrl } from "@/lib/env";

export const runtime = "nodejs";

export async function GET(req: NextRequest, { params }: { params: Promise<{ platform: string }> }) {
  const { platform } = await params;
  const q = req.nextUrl.searchParams;
  const state = await loadConnectState(q.get("state"), platform);
  if (!state || !isPlatformId(platform)) {
    return NextResponse.redirect(`${appUrl()}/connect/expired`);
  }
  const fail = async (message: string) => {
    await db.oAuthState.delete({ where: { id: state.id } }).catch(() => {});
    return NextResponse.redirect(connectReturnUrl(state, { error: message, platform }));
  };

  const providerError = q.get("error_description") || q.get("error_message") || q.get("error");
  if (providerError) return fail(`The connection was not approved: ${providerError}`);

  const adapter = getAdapter(platform);
  const code = q.get("code");
  if (!adapter || adapter.kind !== "oauth" || !code) return fail("Missing authorization code.");

  try {
    const app = await appForState(state);
    if (!app) return fail(`${adapter.name} is not configured.`);
    const accounts = await adapter.exchangeCode({
      app,
      code,
      redirectUri: oauthRedirectUri(platform),
      codeVerifier: state.codeVerifier ?? undefined,
    });
    if (accounts.length === 0) return fail(`No ${adapter.name} accounts were found for this login.`);
    if (accounts.length > 1) {
      // Several Pages or locations: let the user choose which ones to add.
      await storePendingAccounts(state.id, accounts);
      return NextResponse.redirect(`${appUrl()}/connect/${platform}/select?state=${encodeURIComponent(state.state)}`);
    }
    const saved = await saveAccounts({
      userId: state.userId,
      profileId: state.profileId,
      platform,
      platformAppId: state.platformAppId,
      accounts,
    });
    await db.oAuthState.delete({ where: { id: state.id } }).catch(() => {});
    return NextResponse.redirect(
      connectReturnUrl(state, {
        connected: platform,
        accountId: saved[0].id,
        accountIds: saved.map((a) => a.id).join(","),
        profileId: state.profileId,
        username: saved[0].username ?? undefined,
      }),
    );
  } catch (err) {
    if (!(err instanceof PlatformError) && !(err instanceof LimitError)) console.error(`[connect] ${platform} callback failed`, err);
    return fail((err as Error).message);
  }
}
