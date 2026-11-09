import { createHmac, timingSafeEqual } from "crypto";

export const PLATFORMS = [
  { name: "X (Twitter)", value: "twitter" },
  { name: "LinkedIn", value: "linkedin" },
  { name: "Facebook Pages", value: "facebook" },
  { name: "Instagram", value: "instagram" },
  { name: "Threads", value: "threads" },
  { name: "TikTok", value: "tiktok" },
  { name: "YouTube", value: "youtube" },
  { name: "Pinterest", value: "pinterest" },
  { name: "Reddit", value: "reddit" },
  { name: "Google Business Profile", value: "googlebusiness" },
  { name: "Bluesky", value: "bluesky" },
  { name: "Mastodon", value: "mastodon" },
  { name: "Telegram", value: "telegram" },
  { name: "Discord", value: "discord" },
];

export const WEBHOOK_EVENTS = [
  { name: "Post Published", value: "post.published", description: "Every target account published the post" },
  { name: "Post Partially Published", value: "post.partial", description: "Some target accounts failed" },
  { name: "Post Failed", value: "post.failed", description: "No target account published the post" },
  { name: "Account Connected", value: "account.connected" },
  { name: "Account Disconnected", value: "account.disconnected" },
  { name: "Account Expired", value: "account.expired", description: "The user must reconnect the account" },
];

export const SIGNATURE_HEADER = "x-fanout-signature";

/** Media types the API accepts, by file extension. */
export const MEDIA_CONTENT_TYPES: Record<string, string> = {
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  png: "image/png",
  gif: "image/gif",
  webp: "image/webp",
  mp4: "video/mp4",
  m4v: "video/mp4",
  mov: "video/quicktime",
  webm: "video/webm",
};

export function contentTypeFromFilename(filename?: string): string | undefined {
  const ext = filename?.split(".").pop()?.toLowerCase();
  return ext && filename!.includes(".") ? MEDIA_CONTENT_TYPES[ext] : undefined;
}

export function normalizeBaseUrl(url: string): string {
  return String(url || "").replace(/\/+$/, "");
}

/**
 * Check a webhook signature. Header format: t=<unix seconds>,v1=<hex HMAC-SHA256 of "<t>.<raw body>">.
 * Rejects signatures older than toleranceSeconds to stop replays.
 */
export function verifySignature(
  rawBody: string,
  header: string | undefined,
  secret: string,
  toleranceSeconds = 300,
  nowSeconds = Math.floor(Date.now() / 1000),
): boolean {
  if (!header || !secret) return false;
  const parts: Record<string, string> = {};
  for (const piece of header.split(",")) {
    const index = piece.indexOf("=");
    if (index > 0) parts[piece.slice(0, index).trim()] = piece.slice(index + 1).trim();
  }
  const timestamp = Number(parts.t);
  if (!parts.v1 || !Number.isFinite(timestamp)) return false;
  if (Math.abs(nowSeconds - timestamp) > toleranceSeconds) return false;
  const expected = createHmac("sha256", secret).update(`${parts.t}.${rawBody}`).digest("hex");
  const a = Buffer.from(parts.v1);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}
