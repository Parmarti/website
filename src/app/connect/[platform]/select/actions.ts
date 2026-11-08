"use server";

import { redirect } from "next/navigation";
import { db } from "@/lib/db";
import { loadConnectState, saveAccounts } from "@/lib/accounts";
import { connectReturnUrl, readPendingAccounts } from "@/lib/connect";
import { isPlatformId } from "@/lib/platforms";

export type SelectState = { error?: string } | undefined;

export async function saveSelection(_prev: SelectState, formData: FormData): Promise<SelectState> {
  const platform = String(formData.get("platform"));
  const state = await loadConnectState(String(formData.get("state")), platform);
  if (!state || !isPlatformId(platform) || !state.pendingAccounts) return { error: "This link has expired. Start the connection again." };
  const chosen = new Set(formData.getAll("ids").map(String));
  const accounts = readPendingAccounts(state).filter((a) => chosen.has(a.platformAccountId));
  if (accounts.length === 0) return { error: "Select at least one." };

  let target: string;
  try {
    const saved = await saveAccounts({ userId: state.userId, profileId: state.profileId, platform, platformAppId: state.platformAppId, accounts });
    await db.oAuthState.delete({ where: { id: state.id } }).catch(() => {});
    target = connectReturnUrl(state, {
      connected: platform,
      accountId: saved[0].id,
      accountIds: saved.map((a) => a.id).join(","),
      profileId: state.profileId,
      username: saved[0].username ?? undefined,
    });
  } catch (err) {
    return { error: (err as Error).message };
  }
  redirect(target);
}
