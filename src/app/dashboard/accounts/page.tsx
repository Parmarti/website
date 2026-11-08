import { requireUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { getPlan } from "@/lib/plans";
import { platformList } from "@/lib/platforms";
import { sharedAppCredentials } from "@/lib/platform-apps";
import { Alert, Badge, Button, Card, Input, PageHeader, Select, statusTone } from "@/components/ui";
import { PlatformIcon } from "@/components/platform-icon";
import { connectAccount, createProfile, deleteProfile, disconnect } from "../actions";

export default async function AccountsPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const user = await requireUser();
  const sp = await searchParams;
  const [profiles, accounts, ownApps] = await Promise.all([
    db.profile.findMany({ where: { userId: user.id }, orderBy: { createdAt: "asc" } }),
    db.socialAccount.findMany({ where: { userId: user.id }, orderBy: { createdAt: "asc" } }),
    db.platformApp.findMany({ where: { userId: user.id }, select: { platform: true } }),
  ]);
  const own = new Set(ownApps.map((a) => a.platform));
  const plan = getPlan(user.plan);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Accounts"
        description={`${accounts.length} of ${plan.accounts} accounts used on the ${plan.name} plan. Use profiles to keep each customer's accounts apart.`}
      />
      {sp.connected ? <Alert tone="green">Connected {sp.username ? `@${sp.username} on ` : ""}{sp.connected}.</Alert> : null}
      {sp.error ? <Alert tone="red">{sp.error}</Alert> : null}

      <Card className="p-5">
        <h2 className="font-semibold">Connect an account</h2>
        <form action={connectAccount} className="mt-3 space-y-4">
          <div className="sm:w-64">
            <label className="mb-1.5 block text-sm font-medium" htmlFor="profileId">Into profile</label>
            <Select id="profileId" name="profileId" defaultValue={profiles[0]?.id}>
              {profiles.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
            </Select>
          </div>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4">
            {platformList.map((p) => {
              const available = p.kind === "credentials" || own.has(p.id) || Boolean(sharedAppCredentials(p.id));
              return (
                <button
                  key={p.id}
                  name="platform"
                  value={p.id}
                  disabled={!available}
                  title={available ? `Connect ${p.name}` : `Add your ${p.name} developer app first (Developer apps page)`}
                  className="flex items-center gap-2 rounded-lg border border-line bg-white px-3 py-2.5 text-left text-sm font-medium hover:border-brand disabled:cursor-not-allowed disabled:opacity-40"
                >
                  <PlatformIcon platform={p.id} size={24} />
                  <span className="truncate">{p.name}</span>
                </button>
              );
            })}
          </div>
          <p className="text-xs text-muted">Greyed out networks need a developer app. Add yours on the Developer apps page.</p>
        </form>
      </Card>

      {profiles.map((profile) => {
        const list = accounts.filter((a) => a.profileId === profile.id);
        return (
          <Card key={profile.id}>
            <div className="flex items-center justify-between border-b border-line px-5 py-3">
              <div>
                <h3 className="font-semibold">{profile.name}</h3>
                <div className="font-mono text-xs text-muted">profileId: {profile.id}</div>
              </div>
              {profiles.length > 1 ? (
                <form action={deleteProfile}>
                  <input type="hidden" name="id" value={profile.id} />
                  <Button variant="ghost" size="sm">Delete profile</Button>
                </form>
              ) : null}
            </div>
            {list.length === 0 ? (
              <p className="px-5 py-4 text-sm text-muted">No accounts in this profile.</p>
            ) : (
              <ul className="divide-y divide-line">
                {list.map((a) => (
                  <li key={a.id} className="flex flex-wrap items-center justify-between gap-3 px-5 py-3">
                    <div className="flex min-w-0 items-center gap-3">
                      <PlatformIcon platform={a.platform} />
                      <div className="min-w-0">
                        <div className="truncate font-medium">{a.displayName || a.username}</div>
                        <div className="truncate font-mono text-xs text-muted">accountId: {a.id}</div>
                        {a.lastError ? <div className="text-xs text-bad">{a.lastError}</div> : null}
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      <Badge tone={statusTone(a.status)}>{a.status}</Badge>
                      <form action={disconnect}>
                        <input type="hidden" name="id" value={a.id} />
                        <Button variant="danger" size="sm">Disconnect</Button>
                      </form>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        );
      })}

      <Card className="p-5">
        <h2 className="font-semibold">New profile</h2>
        <form action={createProfile} className="mt-3 flex gap-2">
          <Input name="name" placeholder="e.g. Acme Coffee (client)" required aria-label="Profile name" />
          <Button variant="secondary">Create</Button>
        </form>
      </Card>
    </div>
  );
}
