import type { CredentialAdapter } from "./types";
import { PlatformError, fetchJson, str } from "./http";

const ALLOWED_HOSTS = new Set(["discord.com", "discordapp.com", "ptb.discord.com", "canary.discord.com"]);

function parseWebhookUrl(raw: string): URL {
  let url: URL;
  try {
    url = new URL(raw.trim());
  } catch {
    throw new PlatformError("Enter a valid Discord webhook URL.");
  }
  if (url.protocol !== "https:" || !ALLOWED_HOSTS.has(url.hostname) || !/^\/api\/webhooks\/\d+\/[\w-]+$/.test(url.pathname)) {
    throw new PlatformError("This is not a Discord webhook URL. It should look like https://discord.com/api/webhooks/<id>/<token>.");
  }
  return url;
}

export const discordAdapter: CredentialAdapter = {
  id: "discord",
  name: "Discord",
  kind: "credentials",
  maxChars: 2000,
  maxImages: 10,
  supportsVideo: true,
  supportsText: true,
  helpText: "In Discord open Server Settings > Integrations > Webhooks, create a webhook for the channel and copy its URL.",
  fields: [{ name: "webhookUrl", label: "Webhook URL", type: "url", placeholder: "https://discord.com/api/webhooks/..." }],
  validate({ content, media }) {
    const problems: string[] = [];
    if (content.length > 2000) problems.push("Discord messages are limited to 2000 characters.");
    if (!content && media.length === 0) problems.push("Discord posts need text or media.");
    return problems;
  },
  async verify(fields) {
    const url = parseWebhookUrl(fields.webhookUrl || "");
    const hook = await fetchJson<any>(url.toString(), { label: "Discord webhook check" });
    return {
      identity: {
        platformAccountId: String(hook.id),
        username: hook.name ?? null,
        displayName: hook.name ? `${hook.name} (webhook)` : "Discord webhook",
        avatarUrl: hook.avatar ? `https://cdn.discordapp.com/avatars/${hook.id}/${hook.avatar}.png` : null,
        metadata: { channelId: hook.channel_id, guildId: hook.guild_id },
      },
      credentials: { webhookUrl: url.toString() },
    };
  },
  async publish(ctx) {
    const raw = ctx.credentials?.webhookUrl;
    if (!raw) throw new PlatformError("Missing Discord webhook URL. Reconnect the channel.", { auth: true });
    const url = parseWebhookUrl(raw);
    url.searchParams.set("wait", "true");

    const images = ctx.media.filter((m) => m.type === "image").slice(0, 10);
    const videos = ctx.media.filter((m) => m.type === "video");
    // Discord unfurls video links, so append them to the message text.
    const content = [ctx.content, ...videos.map((v) => v.url)].filter(Boolean).join("\n").slice(0, 2000);

    let msg: any;
    try {
      msg = await fetchJson<any>(url.toString(), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          content,
          username: str(ctx.options.username),
          avatar_url: str(ctx.options.avatarUrl),
          embeds: images.map((img) => ({ image: { url: img.url }, description: img.altText })),
          allowed_mentions: { parse: ctx.options.allowMentions === true ? ["users", "roles", "everyone"] : [] },
        }),
        label: "Discord post",
      });
    } catch (err) {
      if (err instanceof PlatformError && (err.opts.status === 401 || err.opts.status === 404)) {
        throw new PlatformError("The Discord webhook no longer exists. Reconnect the channel.", { auth: true });
      }
      throw err;
    }
    const guildId = (ctx.account.metadata.guildId as string) || "@me";
    return { platformPostId: String(msg.id), url: `https://discord.com/channels/${guildId}/${msg.channel_id}/${msg.id}` };
  },
  analytics: {
    note: "Discord webhooks cannot read views or reactions.",
  },
};
