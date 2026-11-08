import { requireUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { Button, Card, PageHeader } from "@/components/ui";
import { revokeApiKey } from "../actions";
import { ApiKeyForm } from "../forms";

export default async function ApiKeysPage() {
  const user = await requireUser();
  const keys = await db.apiKey.findMany({ where: { userId: user.id, revokedAt: null }, orderBy: { createdAt: "desc" } });
  return (
    <div className="space-y-6">
      <PageHeader title="API keys" description="Send a key in the Authorization header: Bearer <key>. Keep keys on your server, never in browser code." />
      <Card className="p-5">
        <ApiKeyForm />
      </Card>
      <Card>
        {keys.length === 0 ? (
          <p className="p-5 text-sm text-muted">No keys yet.</p>
        ) : (
          <ul className="divide-y divide-line">
            {keys.map((k) => (
              <li key={k.id} className="flex flex-wrap items-center justify-between gap-3 p-4">
                <div>
                  <div className="font-medium">{k.name}</div>
                  <div className="font-mono text-xs text-muted">{k.prefix}…</div>
                </div>
                <div className="flex items-center gap-4 text-xs text-muted">
                  <span>Created {k.createdAt.toLocaleDateString()}</span>
                  <span>{k.lastUsedAt ? `Last used ${k.lastUsedAt.toLocaleString()}` : "Never used"}</span>
                  <form action={revokeApiKey}>
                    <input type="hidden" name="id" value={k.id} />
                    <Button variant="danger" size="sm">Revoke</Button>
                  </form>
                </div>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}
