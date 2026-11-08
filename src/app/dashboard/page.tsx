import Link from "next/link";
import { requireUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { getPlan } from "@/lib/plans";
import { postsThisMonth } from "@/lib/posts";
import { appUrl } from "@/lib/env";
import { brand } from "@/lib/brand";
import { Alert, Card, CodeBlock, LinkButton, PageHeader } from "@/components/ui";

export default async function Overview({ searchParams }: { searchParams: Promise<{ welcome?: string }> }) {
  const user = await requireUser();
  const { welcome } = await searchParams;
  const plan = getPlan(user.plan);
  const [accounts, keys, posts, published] = await Promise.all([
    db.socialAccount.count({ where: { userId: user.id } }),
    db.apiKey.count({ where: { userId: user.id, revokedAt: null } }),
    postsThisMonth(user.id),
    db.postTarget.count({ where: { post: { userId: user.id }, status: "published" } }),
  ]);
  const base = appUrl();

  const steps = [
    { done: keys > 0, title: "Create an API key", href: "/dashboard/api-keys" },
    { done: accounts > 0, title: "Connect a social account", href: "/dashboard/accounts" },
    { done: published > 0, title: "Publish your first post", href: "/dashboard/posts" },
  ];

  return (
    <div className="space-y-6">
      <PageHeader title="Overview" description={`Welcome${user.name ? `, ${user.name}` : ""}. Here is where things stand.`} />
      {welcome ? <Alert tone="green">Your account is ready. Follow the three steps below to send your first post.</Alert> : null}

      <div className="grid gap-4 sm:grid-cols-3">
        <Card className="p-5">
          <div className="text-sm text-muted">Connected accounts</div>
          <div className="mt-1 text-2xl font-semibold">{accounts} <span className="text-base font-normal text-muted">/ {plan.accounts}</span></div>
        </Card>
        <Card className="p-5">
          <div className="text-sm text-muted">Posts this month</div>
          <div className="mt-1 text-2xl font-semibold">{posts} <span className="text-base font-normal text-muted">/ {plan.postsPerMonth ?? "unlimited"}</span></div>
        </Card>
        <Card className="p-5">
          <div className="text-sm text-muted">Plan</div>
          <div className="mt-1 flex items-center justify-between">
            <span className="text-2xl font-semibold">{plan.name}</span>
            {plan.id === "free" ? <LinkButton href="/dashboard/billing" size="sm">Upgrade</LinkButton> : null}
          </div>
        </Card>
      </div>

      <Card className="p-5">
        <h2 className="font-semibold">Get started</h2>
        <ol className="mt-3 space-y-2">
          {steps.map((s, i) => (
            <li key={s.title} className="flex items-center gap-3 text-sm">
              <span className={`flex h-6 w-6 items-center justify-center rounded-full text-xs font-semibold ${s.done ? "bg-emerald-100 text-emerald-700" : "bg-wash text-ink-2 ring-1 ring-line"}`}>{s.done ? "✓" : i + 1}</span>
              <Link href={s.href} className={s.done ? "text-muted line-through" : "font-medium text-ink hover:text-brand"}>{s.title}</Link>
            </li>
          ))}
        </ol>
      </Card>

      <Card className="p-5">
        <h2 className="font-semibold">Send a post with one request</h2>
        <p className="mt-1 text-sm text-muted">Replace the key and account ID with your own. See the <Link href="/docs" className="text-brand">API docs</Link> for every option.</p>
        <CodeBlock className="mt-3">{`curl -X POST ${base}/api/v1/posts \\
  -H "Authorization: Bearer ${brand.apiKeyPrefix}..." \\
  -H "Content-Type: application/json" \\
  -d '{
    "content": "Hello from ${brand.name}!",
    "platforms": [{ "platform": "linkedin", "accountId": "ACCOUNT_ID" }],
    "publishNow": true
  }'`}</CodeBlock>
      </Card>
    </div>
  );
}
