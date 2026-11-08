export type PlanId = "free" | "starter" | "growth" | "scale";

export interface Plan {
  id: PlanId;
  name: string;
  priceMonthly: number;
  accounts: number;
  postsPerMonth: number | null; // null = unlimited
  stripePriceEnv?: string;
  highlight?: boolean;
  blurb: string;
}

// Flat pricing. Edit numbers here; the pricing page and limits read from this list.
export const plans: Plan[] = [
  { id: "free", name: "Free", priceMonthly: 0, accounts: 2, postsPerMonth: 100, blurb: "Build and test your integration." },
  { id: "starter", name: "Starter", priceMonthly: 9, accounts: 10, postsPerMonth: null, stripePriceEnv: "STRIPE_PRICE_STARTER", blurb: "Indie apps and small agencies." },
  { id: "growth", name: "Growth", priceMonthly: 29, accounts: 50, postsPerMonth: null, stripePriceEnv: "STRIPE_PRICE_GROWTH", highlight: true, blurb: "SaaS products with real users." },
  { id: "scale", name: "Scale", priceMonthly: 99, accounts: 250, postsPerMonth: null, stripePriceEnv: "STRIPE_PRICE_SCALE", blurb: "Platforms and large agencies." },
];

export function getPlan(id: string | null | undefined): Plan {
  return plans.find((p) => p.id === id) ?? plans[0];
}

export function stripePriceId(plan: Plan): string | undefined {
  return plan.stripePriceEnv ? process.env[plan.stripePriceEnv] : undefined;
}

export function planForStripePrice(priceId: string): Plan | undefined {
  return plans.find((p) => p.stripePriceEnv && process.env[p.stripePriceEnv] === priceId);
}
