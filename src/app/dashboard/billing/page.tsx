import { requireUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { getPlan, plans, stripePriceId } from "@/lib/plans";
import { stripeEnabled } from "@/lib/stripe";
import { Alert, Badge, Button, Card, PageHeader } from "@/components/ui";
import { openBillingPortal, startCheckout } from "../actions";

export default async function BillingPage({ searchParams }: { searchParams: Promise<{ success?: string; error?: string }> }) {
  const user = await requireUser();
  const sp = await searchParams;
  const current = getPlan(user.plan);
  const accounts = await db.socialAccount.count({ where: { userId: user.id } });

  return (
    <div className="space-y-6">
      <PageHeader title="Billing" description={`You are on the ${current.name} plan with ${accounts} of ${current.accounts} accounts used.`} />
      {sp.success ? <Alert tone="green">Thank you! Your plan updates as soon as Stripe confirms the payment (usually a few seconds).</Alert> : null}
      {sp.error ? <Alert tone="red">{sp.error}</Alert> : null}
      {user.subscriptionStatus === "past_due" ? <Alert tone="amber">Your last payment failed. Update your card to keep your plan.</Alert> : null}

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        {plans.map((p) => {
          const isCurrent = p.id === current.id;
          const purchasable = Boolean(stripePriceId(p)) && stripeEnabled();
          return (
            <Card key={p.id} className={`flex flex-col p-5 ${p.highlight ? "ring-2 ring-brand" : ""}`}>
              <div className="flex items-center justify-between">
                <h2 className="font-semibold">{p.name}</h2>
                {isCurrent ? <Badge tone="green">Current</Badge> : null}
              </div>
              <div className="mt-2 text-3xl font-bold">${p.priceMonthly}<span className="text-sm font-normal text-muted">/mo</span></div>
              <ul className="mt-3 flex-1 space-y-1 text-sm text-ink-2">
                <li>{p.accounts} connected accounts</li>
                <li>{p.postsPerMonth ? `${p.postsPerMonth} posts / month` : "Unlimited posts"}</li>
                <li>All 14 networks, analytics, webhooks, API</li>
              </ul>
              {p.id !== "free" && !isCurrent ? (
                <form action={startCheckout} className="mt-4">
                  <input type="hidden" name="plan" value={p.id} />
                  <Button className="w-full" variant={p.highlight ? "primary" : "secondary"} disabled={!purchasable}>
                    {user.stripeSubscriptionId ? "Change plan" : `Upgrade to ${p.name}`}
                  </Button>
                </form>
              ) : null}
            </Card>
          );
        })}
      </div>

      {user.stripeCustomerId ? (
        <Card className="flex flex-wrap items-center justify-between gap-3 p-5">
          <div className="text-sm">
            Manage your card, invoices and cancellation in the Stripe customer portal.
            {user.currentPeriodEnd ? <span className="text-muted"> Current period ends {user.currentPeriodEnd.toLocaleDateString()}.</span> : null}
          </div>
          <form action={openBillingPortal}>
            <Button variant="secondary">Open billing portal</Button>
          </form>
        </Card>
      ) : null}
    </div>
  );
}
