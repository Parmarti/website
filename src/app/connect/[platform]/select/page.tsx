import { redirect } from "next/navigation";
import { db } from "@/lib/db";
import { loadConnectState } from "@/lib/accounts";
import { readPendingAccounts } from "@/lib/connect";
import { getAdapter } from "@/lib/platforms";
import { getPlan } from "@/lib/plans";
import { brand } from "@/lib/brand";
import { PlatformIcon } from "@/components/platform-icon";
import { SelectForm, type Choice } from "./select-form";

export const dynamic = "force-dynamic";
export const metadata = { title: "Choose accounts", robots: { index: false } };

export default async function SelectPage({ params, searchParams }: { params: Promise<{ platform: string }>; searchParams: Promise<{ state?: string }> }) {
  const { platform } = await params;
  const { state: token } = await searchParams;
  const state = await loadConnectState(token, platform);
  const adapter = getAdapter(platform);
  if (!state?.pendingAccounts || !adapter) redirect("/connect/expired");

  const pending = readPendingAccounts(state);
  const [user, existing] = await Promise.all([
    db.user.findUniqueOrThrow({ where: { id: state.userId } }),
    db.socialAccount.findMany({ where: { profileId: state.profileId, platform }, select: { platformAccountId: true } }),
  ]);
  const used = await db.socialAccount.count({ where: { userId: state.userId } });
  const capacity = Math.max(0, getPlan(user.plan).accounts - used);
  const connected = new Set(existing.map((e) => e.platformAccountId));
  const choices: Choice[] = pending.map((a) => ({
    id: a.platformAccountId,
    name: a.displayName || a.username || a.platformAccountId,
    detail: a.username && a.username !== a.displayName ? a.username : null,
    avatarUrl: a.avatarUrl ?? null,
    alreadyConnected: connected.has(a.platformAccountId),
  }));

  return (
    <div className="flex min-h-screen items-center justify-center bg-wash px-4 py-12">
      <div className="w-full max-w-md rounded-2xl border border-line bg-white p-6 shadow-sm sm:p-8">
        <div className="mb-2 flex items-center gap-3">
          <PlatformIcon platform={platform} size={40} />
          <h1 className="text-xl font-semibold">Choose what to connect</h1>
        </div>
        <p className="mb-5 text-sm text-muted">Your {adapter.name} login gives access to {pending.length} accounts. Select the ones to connect.</p>
        <SelectForm platform={platform} state={state.state} choices={choices} capacity={capacity} />
        <p className="mt-6 text-center text-xs text-muted">Secured by {brand.name}.</p>
      </div>
    </div>
  );
}
