import { db } from "./db";
import { brand } from "./brand";
import { appUrl } from "./env";
import { randomToken, sha256 } from "./crypto";
import { escapeHtml, sendEmail } from "./email";
import { hashPassword } from "./auth";

const TTL_MS = 60 * 60_000;

/** Create a one-hour reset link and email it. Does nothing (silently) for unknown emails. */
export async function requestPasswordReset(email: string) {
  const user = await db.user.findUnique({ where: { email } });
  if (!user) return;
  await db.passwordResetToken.deleteMany({ where: { userId: user.id, usedAt: null } });
  const token = randomToken(32);
  await db.passwordResetToken.create({ data: { userId: user.id, tokenHash: sha256(token), expiresAt: new Date(Date.now() + TTL_MS) } });
  const link = `${appUrl()}/reset-password?token=${token}`;
  await sendEmail({
    to: user.email,
    subject: `Reset your ${brand.name} password`,
    text: `Someone asked to reset the password for your ${brand.name} account.\n\nOpen this link to choose a new password (it works once, for 1 hour):\n${link}\n\nIf you did not ask for this, ignore this email. Your password stays the same.`,
    html: `<p>Someone asked to reset the password for your ${escapeHtml(brand.name)} account.</p><p><a href="${link}">Choose a new password</a> (the link works once, for 1 hour).</p><p>If you did not ask for this, ignore this email. Your password stays the same.</p>`,
  });
}

export async function findValidResetToken(token: string | null | undefined) {
  if (!token) return null;
  const row = await db.passwordResetToken.findUnique({ where: { tokenHash: sha256(token) } });
  if (!row || row.usedAt || row.expiresAt < new Date()) return null;
  return row;
}

/** Set the new password, use up the token and sign the user out everywhere. Returns the user id. */
export async function completePasswordReset(token: string, newPassword: string): Promise<string | null> {
  const row = await findValidResetToken(token);
  if (!row) return null;
  const passwordHash = await hashPassword(newPassword);
  const { count } = await db.passwordResetToken.updateMany({ where: { id: row.id, usedAt: null }, data: { usedAt: new Date() } });
  if (count !== 1) return null;
  await db.$transaction([
    db.user.update({ where: { id: row.userId }, data: { passwordHash } }),
    db.session.deleteMany({ where: { userId: row.userId } }),
  ]);
  return row.userId;
}
