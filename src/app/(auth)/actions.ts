"use server";

import { redirect } from "next/navigation";
import { z } from "zod";
import { db } from "@/lib/db";
import { createSession, destroySession, hashPassword, verifyPassword } from "@/lib/auth";
import { ensureDefaultProfile } from "@/lib/accounts";

export type AuthState = { error?: string } | undefined;

const credentials = z.object({
  email: z.string().trim().toLowerCase().email("Enter a valid email address."),
  password: z.string().min(8, "Use at least 8 characters for the password.").max(200),
});

export async function signup(_prev: AuthState, formData: FormData): Promise<AuthState> {
  const parsed = credentials.safeParse({ email: formData.get("email"), password: formData.get("password") });
  if (!parsed.success) return { error: parsed.error.issues[0].message };
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
