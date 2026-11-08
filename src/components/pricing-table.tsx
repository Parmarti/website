import { plans } from "@/lib/plans";
import { LinkButton } from "./ui";

export function PricingTable() {
  return (
    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
      {plans.map((p) => (
        <div key={p.id} className={`flex flex-col rounded-2xl border bg-white p-6 ${p.highlight ? "border-brand shadow-lg shadow-brand/10 ring-1 ring-brand" : "border-line"}`}>
          <div className="flex items-center justify-between">
            <h3 className="font-semibold">{p.name}</h3>
            {p.highlight ? <span className="rounded-full bg-brand px-2 py-0.5 text-xs font-medium text-white">Popular</span> : null}
          </div>
          <p className="mt-1 text-sm text-muted">{p.blurb}</p>
          <div className="mt-4 text-4xl font-bold tracking-tight">${p.priceMonthly}<span className="text-base font-normal text-muted">/mo</span></div>
          <ul className="mt-5 flex-1 space-y-2 text-sm text-ink-2">
            <li>✓ {p.accounts} connected accounts</li>
            <li>✓ {p.postsPerMonth ? `${p.postsPerMonth} posts per month` : "Unlimited posts"}</li>
            <li>✓ All 14 networks</li>
            <li>✓ Scheduling, analytics, webhooks</li>
            <li>✓ Bring your own developer apps</li>
          </ul>
          <LinkButton href="/signup" className="mt-6 w-full" variant={p.highlight ? "primary" : "secondary"}>
            {p.priceMonthly === 0 ? "Start free" : `Start with ${p.name}`}
          </LinkButton>
        </div>
      ))}
    </div>
  );
}
