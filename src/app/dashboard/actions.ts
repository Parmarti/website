"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { after } from "next/server";
import { z } from "zod";
import { requireUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { brand } from "@/lib/brand";
import { encrypt, randomToken, sha256 } from "@/lib/crypto";
import { disconnectAccount, startConnect } from "@/lib/accounts";
import { cancelPost, createPost, PostValidationError, retryPost } from "@/lib/posts";
import { processDuePosts } from "@/lib/publisher";
import { emitEvent, newWebhookSecret, WEBHOOK_EVENTS } from "@/lib/webhooks";
import { assertPublicUrl } from "@/lib/net";
import { plans, stripePriceId } from "@/lib/plans";
import { getStripe, stripeEnabled } from "@/lib/stripe";
import { appUrl } from "@/lib/env";
import { isPlatformId, getAdapter } from "@/lib/platforms";

export type FormState = { error?: string; ok?: string; secret?: string; details?: unknown } | undefined;

/* API keys */

export async function createApiKey(_prev: FormState, formData: FormData): Promise<FormState> {
  const user = await requireUser();
  const name = String(formData.get("name") || "").trim() || "Default key";
  if ((await db.apiKey.count({ where: { userId: user.id, revokedAt: null } })) >= 20) return { error: "You can have at most 20 active keys." };
  const key = `${brand.apiKeyPrefix}${randomToken(24)}`;
  await db.apiKey.create({ data: { userId: user.id, name, prefix: key.slice(0, brand.apiKeyPrefix.length + 6), keyHash: sha256(key) } });
  revalidatePath("/dashboard/api-keys");
  return { ok: "Key created. Copy it now: you will not see it again.", secret: key };
}

export async function revokeApiKey(formData: FormData) {
  const user = await requireUser();
  await db.apiKey.updateMany({ where: { id: String(formData.get("id")), userId: user.id }, data: { revokedAt: new Date() } });
  revalidatePath("/dashboard/api-keys");
}

/* Profiles and accounts */

export async function createProfile(formData: FormData) {
  const user = await requireUser();
  const name = String(formData.get("name") || "").trim().slice(0, 100);
  if (name) await db.profile.create({ data: { userId: user.id, name } });
  revalidatePath("/dashboard/accounts");
}

export async function deleteProfile(formData: FormData) {
  const user = await requireUser();
  const id = String(formData.get("id"));
  if ((await db.profile.count({ where: { userId: user.id } })) <= 1) return;
  await db.profile.deleteMany({ where: { id, userId: user.id } });
  revalidatePath("/dashboard/accounts");
}

export async function connectAccount(formData: FormData) {
  const user = await requireUser();
  const platform = String(formData.get("platform"));
  if (!isPlatformId(platform)) return;
  let url: string;
  try {
    url = await startConnect({
      userId: user.id,
      platform,
      profileId: String(formData.get("profileId") || "") || null,
      redirectUrl: `${appUrl()}/dashboard/accounts`,
    });
  } catch (err) {
    redirect(`/dashboard/accounts?error=${encodeURIComponent((err as Error).message)}`);
  }
  redirect(url);
}

export async function disconnect(formData: FormData) {
  const user = await requireUser();
  await disconnectAccount(user.id, String(formData.get("id")));
  revalidatePath("/dashboard/accounts");
}

/* Bring your own developer app */

export async function savePlatformApp(_prev: FormState, formData: FormData): Promise<FormState> {
  const user = await requireUser();
  const platform = String(formData.get("platform"));
  const clientId = String(formData.get("clientId") || "").trim();
  const clientSecret = String(formData.get("clientSecret") || "").trim();
  const adapter = getAdapter(platform);
  if (!adapter || adapter.kind !== "oauth") return { error: "Unknown platform." };
  if (!clientId || !clientSecret) return { error: "Client ID and client secret are required." };
  await db.platformApp.upsert({
    where: { userId_platform: { userId: user.id, platform } },
    create: { userId: user.id, platform, clientId, clientSecret: encrypt(clientSecret) },
    update: { clientId, clientSecret: encrypt(clientSecret) },
  });
  revalidatePath("/dashboard/apps");
  return { ok: `${adapter.name} app saved. New connections will use it.` };
}

export async function deletePlatformApp(formData: FormData) {
  const user = await requireUser();
  await db.platformApp.deleteMany({ where: { userId: user.id, platform: String(formData.get("platform")) } });
  revalidatePath("/dashboard/apps");
}

/* Posts */

export async function createPostAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const user = await requireUser();
  const accountIds = formData.getAll("accountIds").map(String).filter(Boolean);
  const mediaUrls = String(formData.get("mediaUrls") || "")
    .split(/\s+/)
    .map((s) => s.trim())
    .filter(Boolean);
  const when = String(formData.get("when") || "now");
  const scheduledFor = String(formData.get("scheduledFor") || "");
  const timezone = String(formData.get("timezone") || "UTC");
  const options: Record<string, unknown> = {};
  for (const key of ["title", "subreddit", "boardId", "link"]) {
    const value = String(formData.get(key) || "").trim();
    if (value) options[key] = value;
  }
  try {
    const post = await createPost(
      user,
      {
        content: String(formData.get("content") || ""),
        mediaItems: mediaUrls.map((url) => ({ url })),
        platforms: accountIds.map((accountId) => ({ accountId, platformSpecificData: options })),
        ...(when === "later" ? { scheduledFor, timezone } : { publishNow: true }),
        isDraft: when === "draft",
      },
      "dashboard",
    );
    if (post.status === "scheduled" && post.scheduledFor <= new Date()) {
      after(() => processDuePosts({ maxBatches: 2 }).catch((err) => console.error(err)));
    }
  } catch (err) {
    if (err instanceof PostValidationError) return { error: err.message, details: err.details };
    if (err instanceof z.ZodError) return { error: err.issues.map((i) => i.message).join(" ") };
    return { error: (err as Error).message };
  }
  revalidatePath("/dashboard/posts");
  return { ok: when === "later" ? "Post scheduled." : when === "draft" ? "Draft saved." : "Publishing now. Refresh in a few seconds to see the result." };
}

export async function cancelPostAction(formData: FormData) {
  const user = await requireUser();
  await cancelPost(user.id, String(formData.get("id")));
  revalidatePath("/dashboard/posts");
}

export async function retryPostAction(formData: FormData) {
  const user = await requireUser();
  const count = await retryPost(user.id, String(formData.get("id")));
  if (count) after(() => processDuePosts({ maxBatches: 2 }).catch(() => {}));
  revalidatePath("/dashboard/posts");
}

/* Webhooks */

export async function createWebhookAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const user = await requireUser();
  const url = String(formData.get("url") || "").trim();
  const events = formData.getAll("events").map(String).filter((e) => (WEBHOOK_EVENTS as readonly string[]).includes(e));
  try {
    await assertPublicUrl(url);
  } catch (err) {
    return { error: (err as Error).message };
  }
  if ((await db.webhook.count({ where: { userId: user.id } })) >= 10) return { error: "You can have at most 10 webhooks." };
  const hook = await db.webhook.create({ data: { userId: user.id, url, events, secret: newWebhookSecret() } });
  revalidatePath("/dashboard/webhooks");
  return { ok: "Webhook created. Use this secret to verify signatures:", secret: hook.secret };
}

export async function deleteWebhookAction(formData: FormData) {
  const user = await requireUser();
  await db.webhook.deleteMany({ where: { id: String(formData.get("id")), userId: user.id } });
  revalidatePath("/dashboard/webhooks");
}

export async function testWebhookAction(formData: FormData) {
  const user = await requireUser();
  const id = String(formData.get("id"));
  await emitEvent(user.id, "webhook.test", { message: "This is a test event." }, id);
  revalidatePath("/dashboard/webhooks");
}

/* Billing */

export async function startCheckout(formData: FormData) {
  const user = await requireUser();
  const plan = plans.find((p) => p.id === formData.get("plan"));
  const price = plan && stripePriceId(plan);
  if (!plan || !price || !stripeEnabled()) redirect("/dashboard/billing?error=Billing+is+not+configured+yet");
  const stripe = getStripe();

  if (user.stripeSubscriptionId) {
    const session = await stripe.billingPortal.sessions.create({ customer: user.stripeCustomerId!, return_url: `${appUrl()}/dashboard/billing` });
    redirect(session.url);
  }
  let customerId = user.stripeCustomerId;
  if (!customerId) {
    const customer = await stripe.customers.create({ email: user.email, name: user.name ?? undefined, metadata: { userId: user.id } });
    customerId = customer.id;
    await db.user.update({ where: { id: user.id }, data: { stripeCustomerId: customerId } });
  }
  const session = await stripe.checkout.sessions.create({
    mode: "subscription",
    customer: customerId,
    client_reference_id: user.id,
    line_items: [{ price, quantity: 1 }],
    allow_promotion_codes: true,
    subscription_data: { metadata: { userId: user.id } },
    success_url: `${appUrl()}/dashboard/billing?success=1`,
    cancel_url: `${appUrl()}/dashboard/billing`,
  });
  redirect(session.url!);
}

export async function openBillingPortal() {
  const user = await requireUser();
  if (!user.stripeCustomerId || !stripeEnabled()) redirect("/dashboard/billing");
  const session = await getStripe().billingPortal.sessions.create({ customer: user.stripeCustomerId, return_url: `${appUrl()}/dashboard/billing` });
  redirect(session.url);
}
