import Stripe from "stripe";
import { db } from "./db";
import { planForStripePrice } from "./plans";

let client: Stripe | null = null;

export function stripeEnabled() {
  return Boolean(process.env.STRIPE_SECRET_KEY);
}

export function getStripe(): Stripe {
  if (!process.env.STRIPE_SECRET_KEY) throw new Error("STRIPE_SECRET_KEY is not set");
  client ??= new Stripe(process.env.STRIPE_SECRET_KEY);
  return client;
}

/** Copy subscription state from Stripe onto the user. */
export async function syncSubscription(sub: Stripe.Subscription) {
  const customerId = typeof sub.customer === "string" ? sub.customer : sub.customer.id;
  const item = sub.items.data[0];
  const plan = item ? planForStripePrice(item.price.id) : undefined;
  const active = ["active", "trialing", "past_due"].includes(sub.status);
  const periodEnd = (item as unknown as { current_period_end?: number })?.current_period_end
    ?? (sub as unknown as { current_period_end?: number }).current_period_end;

  const user =
    (sub.metadata?.userId && (await db.user.findUnique({ where: { id: sub.metadata.userId } }))) ||
    (await db.user.findUnique({ where: { stripeCustomerId: customerId } }));
  if (!user) {
    console.warn(`[stripe] no user for customer ${customerId}`);
    return;
  }
  await db.user.update({
    where: { id: user.id },
    data: {
      stripeCustomerId: customerId,
      stripeSubscriptionId: active ? sub.id : null,
      subscriptionStatus: sub.status,
      plan: active && plan ? plan.id : "free",
      currentPeriodEnd: periodEnd ? new Date(periodEnd * 1000) : null,
    },
  });
}
