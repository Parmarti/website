import { brand } from "./brand";

export interface EmailMessage {
  to: string;
  subject: string;
  text: string;
  html?: string;
}

/**
 * Send an email through Resend when RESEND_API_KEY is set.
 * Without a key (local development), the email is written to the server log instead.
 */
export async function sendEmail(msg: EmailMessage): Promise<{ sent: boolean; id?: string; error?: string }> {
  const key = process.env.RESEND_API_KEY;
  const from = process.env.EMAIL_FROM || `${brand.name} <${brand.supportEmail}>`;
  if (!key) {
    console.log(`[email] RESEND_API_KEY is not set, so this email was not sent.\nTo: ${msg.to}\nSubject: ${msg.subject}\n\n${msg.text}`);
    return { sent: false, error: "not_configured" };
  }
  try {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify({ from, to: [msg.to], subject: msg.subject, text: msg.text, html: msg.html, reply_to: brand.supportEmail }),
      signal: AbortSignal.timeout(15_000),
    });
    const body = (await res.json().catch(() => ({}))) as { id?: string; message?: string };
    if (!res.ok) {
      console.error("[email] Resend rejected the email", res.status, body);
      return { sent: false, error: body.message ?? `HTTP ${res.status}` };
    }
    return { sent: true, id: body.id };
  } catch (err) {
    console.error("[email] send failed", err);
    return { sent: false, error: (err as Error).message };
  }
}

export function escapeHtml(s: string) {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
}
