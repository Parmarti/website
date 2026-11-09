"use server";

import { redirect } from "next/navigation";
import { z } from "zod";
import { db } from "@/lib/db";
import { createSession, destroySession, hashPassword, verifyPassword } from "@/lib/auth";
import { ensureDefaultProfile } from "@/lib/accounts";
import { headers } from "next/headers";
import { hit } from "@/lib/rate-limit";
import { completePasswordReset, requestPasswordReset } from "@/lib/password-reset";

async function clientIp() {
  const h = await headers();
  return h.get("x-forwarded-for")?.split(",")[0].trim() || h.get("x-real-ip") || "unknown";
}

export type AuthState = { error?: string; ok?: string } | undefined;

const credentials = z.object({
  email: z.string().trim().toLowerCase().email("Enter a valid email address."),
  password: z.string().min(8, "Use at least 8 characters for the password.").max(200),
});

export async function signup(_prev: AuthState, formData: FormData): Promise<AuthState> {
  const parsed = credentials.safeParse({ email: formData.get("email"), password: formData.get("password") });
  if (!parsed.success) return { error: parsed.error.issues[0].message };
  if (!hit(`signup-ip:${await clientIp()}`, 10, 60 * 60_000).ok) return { error: "Too many sign-ups from this network. Try again later." };
  const { email, password } = parsed.data;
  if (await db.user.findUnique({ where: { email } })) return { error: "An account with this email already exists. Log in instead." };
  const user = await db.user.create({
    data: { email, name: String(formData.get("name") || "").trim() || null, passwordHash: await hashPassword(password) },
  });
  await ensureDefaultProfile(user.id);
  await createSession(user.id);
  redirect("/dashboard?welcome=1");
}

export async function login(_prev: AuthState, formData: FormData): Promise<AuthState> {
  const parsed = credentials.safeParse({ email: formData.get("email"), password: formData.get("password") });
  if (!parsed.success) return { error: "Wrong email or password." };
  // Slow down password guessing: 10 tries per 15 minutes per IP and per email.
  const ip = await clientIp();
  const byIp = hit(`login-ip:${ip}`, 30, 15 * 60_000);
  const byEmail = hit(`login-email:${parsed.data.email}`, 10, 15 * 60_000);
  if (!byIp.ok || !byEmail.ok) return { error: "Too many attempts. Wait 15 minutes and try again." };
  const user = await db.user.findUnique({ where: { email: parsed.data.email } });
  if (!user || !(await verifyPassword(parsed.data.password, user.passwordHash))) return { error: "Wrong email or password." };
  await createSession(user.id);
  const next = String(formData.get("next") || "");
  redirect(next.startsWith("/dashboard") ? next : "/dashboard");
}

export async function logout() {
  await destroySession();
  redirect("/");
}

export async function forgotPassword(_prev: AuthState, formData: FormData): Promise<AuthState> {
  const email = String(formData.get("email") || "").trim().toLowerCase();
  if (!z.string().email().safeParse(email).success) return { error: "Enter a valid email address." };
  const ip = await clientIp();
  if (hit(`reset-ip:${ip}`, 10, 60 * 60_000).ok && hit(`reset-email:${email}`, 3, 60 * 60_000).ok) {
    await requestPasswordReset(email);
  }
  // Same answer whether or not the account exists, so the form does not reveal who has an account.
  return { ok: "If an account exists for this email, we sent a link to reset the password. Check your inbox." };
}

export async function resetPassword(_prev: AuthState, formData: FormData): Promise<AuthState> {
  const token = String(formData.get("token") || "");
  const password = String(formData.get("password") || "");
  if (password.length < 8) return { error: "Use at least 8 characters for the password." };
  if (password !== String(formData.get("confirm") || "")) return { error: "The two passwords are not the same." };
  const userId = await completePasswordReset(token, password);
  if (!userId) return { error: "This reset link has expired or was already used. Ask for a new one." };
  await createSession(userId);
  redirect("/dashboard?reset=1");
}
