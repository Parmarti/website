import { plans } from "@/lib/plans";
import { PricingTable } from "@/components/pricing-table";

export const metadata = { title: "Pricing" };

export default function PricingPage() {
  const examples = [10, 50, 250];
  return (
    <div className="mx-auto max-w-6xl px-4 py-16 sm:py-20">
      <div className="text-center">
        <h1 className="text-4xl font-bold tracking-tight">Flat pricing. Every feature on every plan.</h1>
        <p className="mx-auto mt-4 max-w-2xl text-lg text-ink-2">
          Pay for a bucket of connected accounts, not per account. Posts are unlimited on paid plans and there are no extra fees for any network.
        </p>
      </div>
      <div className="mt-12">
        <PricingTable />
      </div>
      <div className="mx-auto mt-16 max-w-2xl rounded-2xl border border-line bg-white p-6">
        <h2 className="font-semibold">What you pay at common sizes</h2>
        <table className="mt-4 w-full text-sm">
          <thead>
            <tr className="text-left text-muted">
              <th className="py-2 font-medium">Connected accounts</th>
              <th className="py-2 font-medium">Plan</th>
              <th className="py-2 text-right font-medium">Per month</th>
            </tr>
          </thead>
          <tbody>
            {examples.map((n) => {
              const plan = plans.find((p) => p.accounts >= n)!;
              return (
                <tr key={n} className="border-t border-line">
                  <td className="py-2">{n}</td>
                  <td className="py-2">{plan.name}</td>
                  <td className="py-2 text-right font-semibold">${plan.priceMonthly}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
        <p className="mt-4 text-sm text-muted">Need more than {plans[plans.length - 1].accounts} accounts? Email us for volume pricing.</p>
      </div>
    </div>
  );
}
