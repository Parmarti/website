import { requireUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { platformList, type OAuthAdapter } from "@/lib/platforms";
import { sharedAppCredentials } from "@/lib/platform-apps";
import { oauthRedirectUri } from "@/lib/accounts";
import { Badge, Button, Card, PageHeader } from "@/components/ui";
import { PlatformIcon } from "@/components/platform-icon";
import { deletePlatformApp } from "../actions";
import { PlatformAppForm } from "../forms";

export default async function AppsPage() {
  const user = await requireUser();
  const apps = await db.platformApp.findMany({ where: { userId: user.id } });
  const byPlatform = new Map(apps.map((a) => [a.platform, a]));
  const oauth = platformList.filter((p): p is OAuthAdapter => p.kind === "oauth");

  return (
    <div className="space-y-6">
      <PageHeader
        title="Developer apps"
        description="Use your own developer app for a network. Your users then see your brand on the consent screen, and the network's rate limits and fees apply to your app only."
      />
      {oauth.map((p) => {
        const app = byPlatform.get(p.id);
        const shared = Boolean(sharedAppCredentials(p.id));
        return (
          <Card key={p.id} className="p-5">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-3">
                <PlatformIcon platform={p.id} />
                <h2 className="font-semibold">{p.name}</h2>
                {app ? <Badge tone="green">Using your app</Badge> : shared ? <Badge tone="blue">Using shared app</Badge> : <Badge tone="amber">Needs an app</Badge>}
              </div>
              {app ? (
                <form action={deletePlatformApp}>
                  <input type="hidden" name="platform" value={p.id} />
                  <Button variant="ghost" size="sm">Remove</Button>
                </form>
              ) : null}
            </div>
            {p.setupNote ? <p className="mt-2 text-sm text-muted">{p.setupNote}</p> : null}
            <div className="mt-3">
              <PlatformAppForm platform={p.id} name={p.name} redirectUri={oauthRedirectUri(p.id)} existingClientId={app?.clientId} />
            </div>
          </Card>
        );
      })}
    </div>
  );
}
