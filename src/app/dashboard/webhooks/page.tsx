import { requireUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { brand } from "@/lib/brand";
import { Badge, Button, Card, PageHeader } from "@/components/ui";
import { deleteWebhookAction, testWebhookAction } from "../actions";
import { WebhookForm } from "../forms";

export default async function WebhooksPage() {
  const user = await requireUser();
  const hooks = await db.webhook.findMany({ where: { userId: user.id }, orderBy: { createdAt: "asc" } });
  return (
    <div className="space-y-6">
      <PageHeader
        title="Webhooks"
        description={<>We POST JSON to your endpoint when posts finish or accounts change. Each request has a <code>{brand.webhookSignatureHeader}</code> header you can verify with your secret.</>}
      />
      <Card className="p-5">
        <WebhookForm />
      </Card>
      {hooks.length ? (
        <Card>
          <ul className="divide-y divide-line">
            {hooks.map((h) => (
              <li key={h.id} className="flex flex-wrap items-center justify-between gap-3 p-4">
                <div className="min-w-0">
                  <div className="truncate font-mono text-sm">{h.url}</div>
                  <div className="mt-1 text-xs text-muted">{h.events.length ? h.events.join(", ") : "All events"}</div>
                </div>
                <div className="flex items-center gap-2">
                  {h.lastDelivered ? <Badge tone={h.lastError ? "red" : "green"}>{h.lastError ? `Failed: ${h.lastError}` : `OK ${h.lastStatus}`}</Badge> : <Badge>Not used yet</Badge>}
                  <form action={testWebhookAction}>
                    <input type="hidden" name="id" value={h.id} />
                    <Button variant="secondary" size="sm">Send test</Button>
                  </form>
                  <form action={deleteWebhookAction}>
                    <input type="hidden" name="id" value={h.id} />
                    <Button variant="danger" size="sm">Delete</Button>
                  </form>
                </div>
              </li>
            ))}
          </ul>
        </Card>
      ) : null}
    </div>
  );
}
