"use server";

import { redirect } from "next/navigation";
import { db } from "@/lib/db";
import { loadConnectState, saveAccounts } from "@/lib/accounts";
import { connectReturnUrl } from "@/lib/connect";
import { getAdapter, isPlatformId } from "@/lib/platforms";

export type ConnectFormState = { error?: string } | undefined;

export async function connectWithCredentials(_prev: ConnectFormState, formData: FormData): Promise<ConnectFormState> {
  const platform = String(formData.get("platform"));
  const state = await loadConnectState(String(formData.get("state")), platform);
  if (!state || !isPlatformId(platform)) return { error: "This connect link has expired. Go back and start again." };
  const adapter = getAdapter(platform);
  if (!adapter || adapter.kind !== "credentials") return { error: "Unknown platform." };

  const fields: Record<string, string> = {};
  for (const f of adapter.fields) fields[f.name] = String(formData.get(f.name) || "");

  let target: string;
  try {
    const { identity, credentials } = await adapter.verify(fields);
    const [saved] = await saveAccounts({
      userId: state.userId,
      profileId: state.profileId,
      platform,
      platformAppId: null,
      accounts: [{ ...identity, credentials }],
    });
    await db.oAuthState.delete({ where: { id: state.id } }).catch(() => {});
    target = connectReturnUrl(state, {
      connected: platform,
      accountId: saved.id,
      accountIds: saved.id,
      profileId: state.profileId,
      username: saved.username ?? undefined,
    });
  } catch (err) {
    return { error: (err as Error).message };
  }
  redirect(target);
}
