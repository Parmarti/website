"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { destroySession, hashPassword, requireUser, revokeOtherSessions, verifyPassword } from "@/lib/auth";
import { db } from "@/lib/db";
import { deleteAllMedia } from "@/lib/media";
import { getStripe, stripeEnabled } from "@/lib/stripe";

export type SettingsState = { error?: string; ok?: string } | undefined;

export async function updateProfile(_prev: SettingsState, formData: FormData): Promise<SettingsState> {
  const user = await requireUser();
  const name = String(formData.get("name") || "").trim().slice(0, 100);
  await db.user.update({ where: { id: user.id }, data: { name: name || null } });
  revalidatePath("/dashboard", "layout");
  return { ok: "Saved." };
}

export async function changePassword(_prev: SettingsState, formData: FormData): Promise<SettingsState> {
  const user = await requireUser();
  const current = String(formData.get("current") || "");
  const next = String(formData.get("password") || "");
  if (!(await verifyPassword(current, user.passwordHash))) return { error: "Your current password is not correct." };
  if (next.length < 8) return { error: "Use at least 8 characters for the new password." };
  if (next !== String(formData.get("confirm") || "")) return { error: "The two new passwords are not the same." };
  await db.user.update({ where: { id: user.id }, data: { passwordHash: await hashPassword(next) } });
  await revokeOtherSessions(user.id); // stay signed in here; other devices are signed out
  return { ok: "Password changed. Other devices were signed out." };
}

export async function deleteAccount(_prev: SettingsState, formData: FormData): Promise<SettingsState> {
  const user = await requireUser();
  if (String(formData.get("confirm") || "").trim().toLowerCase() !== user.email) {
    return { error: "Type your email address exactly to confirm." };
  }
  if (user.stripeSubscriptionId && stripeEnabled()) {
    try {
      await getStripe().subscriptions.cancel(user.stripeSubscriptionId);
    } catch (err) {
      console.error("[settings] could not cancel subscription", err);
      return { error: "We could not cancel your subscription. Cancel it in the billing portal first, then try again." };
    }
  }
  await deleteAllMedia(user.id);
  await db.user.delete({ where: { id: user.id } }); // cascades to accounts, tokens, posts, keys, webhooks, media rows
  await destroySession();
  redirect("/?deleted=1");
}
