import type { CredentialAdapter } from "./types";
import { PlatformError, fetchJson, str } from "./http";

const API = "https://api.telegram.org";
const CAPTION_LIMIT = 1024;

async function call<T = any>(token: string, method: string, body: Record<string, unknown>): Promise<T> {
  try {
    const res = await fetchJson<{ ok: boolean; result: T; description?: string }>(`${API}/bot${token}/${method}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      label: `Telegram ${method}`,
    });
    if (!res.ok) throw new PlatformError(`Telegram ${method} failed: ${res.description}`);
    return res.result;
  } catch (err) {
    if (err instanceof PlatformError && err.opts.status === 401) {
      throw new PlatformError("Telegram rejected the bot token. Reconnect the channel.", { auth: true });
    }
    // Telegram's error text is in the JSON body.
    if (err instanceof PlatformError && err.opts.body && typeof err.opts.body === "object") {
      const desc = (err.opts.body as any).description;
      if (desc) throw new PlatformError(`Telegram ${method} failed: ${desc}`, err.opts);
    }
    throw err;
  }
}

function botToken(creds: Record<string, string> | null): string {
  const token = creds?.botToken || process.env.TELEGRAM_BOT_TOKEN;
  if (!token) throw new PlatformError("No Telegram bot token configured. Reconnect the channel with a bot token.", { auth: true });
  return token;
}

function messageUrl(chatId: string, username: string | null, messageId: number) {
  if (username) return `https://t.me/${username}/${messageId}`;
  if (chatId.startsWith("-100")) return `https://t.me/c/${chatId.slice(4)}/${messageId}`;
  return null;
}

export const telegramAdapter: CredentialAdapter = {
  id: "telegram",
  name: "Telegram",
  kind: "credentials",
  maxChars: 4096,
  maxImages: 10,
  supportsVideo: true,
  supportsText: true,
  helpText: process.env.TELEGRAM_BOT_TOKEN
    ? "Add our bot as an admin of your channel or group, then enter the chat. You can also use your own bot token."
    : "Create a bot with @BotFather, add it as an admin of your channel or group, then enter the bot token and the chat.",
  fields: [
    {
      name: "botToken",
      label: "Bot token",
      type: "password",
      placeholder: "123456:ABC-DEF...",
      optional: Boolean(process.env.TELEGRAM_BOT_TOKEN),
      help: process.env.TELEGRAM_BOT_TOKEN ? "Leave empty to use the shared bot." : undefined,
    },
    { name: "chatId", label: "Channel or chat", type: "text", placeholder: "@mychannel or -1001234567890" },
  ],
  validate({ content, media }) {
    const problems: string[] = [];
    if (content.length > 4096) problems.push("Telegram messages are limited to 4096 characters.");
    if (media.length > 10) problems.push("Telegram allows at most 10 media items per post.");
    return problems;
  },
  async verify(fields) {
    const ownToken = fields.botToken?.trim();
    const token = ownToken || process.env.TELEGRAM_BOT_TOKEN;
    if (!token) throw new PlatformError("A bot token is required.");
    const chatInput = fields.chatId?.trim();
    if (!chatInput) throw new PlatformError("Enter the channel username (e.g. @mychannel) or numeric chat id.");
    const me = await call<{ id: number; username: string }>(token, "getMe", {});
    const chat = await call<any>(token, "getChat", { chat_id: chatInput });
    const member = await call<{ status: string }>(token, "getChatMember", { chat_id: chat.id, user_id: me.id });
    if (!["administrator", "creator", "member"].includes(member.status)) {
      throw new PlatformError(`@${me.username} is not a member of this chat. Add it as an admin and try again.`);
    }
    const credentials: Record<string, string> = { chatId: String(chat.id) };
    if (ownToken) credentials.botToken = ownToken;
    return {
      identity: {
        platformAccountId: String(chat.id),
        username: chat.username ?? null,
        displayName: chat.title || [chat.first_name, chat.last_name].filter(Boolean).join(" ") || String(chat.id),
        metadata: { chatType: chat.type, botUsername: me.username },
      },
      credentials,
    };
  },
  async publish(ctx) {
    const token = botToken(ctx.credentials);
    const chatId = ctx.credentials?.chatId || ctx.account.platformAccountId;
    const parseMode = str(ctx.options.parseMode); // "HTML" | "MarkdownV2"
    const silent = ctx.options.disableNotification === true;
    const text = ctx.content;
    const captionFits = text.length <= CAPTION_LIMIT;
    let firstMessageId: number;

    if (ctx.media.length === 0) {
      const msg = await call<{ message_id: number }>(token, "sendMessage", {
        chat_id: chatId,
        text,
        parse_mode: parseMode,
        disable_notification: silent,
        link_preview_options: ctx.options.disableLinkPreview === true ? { is_disabled: true } : undefined,
      });
      firstMessageId = msg.message_id;
    } else if (ctx.media.length === 1) {
      const item = ctx.media[0];
      const method = item.type === "video" ? "sendVideo" : "sendPhoto";
      const msg = await call<{ message_id: number }>(token, method, {
        chat_id: chatId,
        [item.type === "video" ? "video" : "photo"]: item.url,
        caption: captionFits ? text : undefined,
        parse_mode: captionFits ? parseMode : undefined,
        disable_notification: silent,
      });
      firstMessageId = msg.message_id;
      if (!captionFits && text) await call(token, "sendMessage", { chat_id: chatId, text, parse_mode: parseMode, disable_notification: silent });
    } else {
      const msgs = await call<{ message_id: number }[]>(token, "sendMediaGroup", {
        chat_id: chatId,
        disable_notification: silent,
        media: ctx.media.slice(0, 10).map((m, i) => ({
          type: m.type === "video" ? "video" : "photo",
          media: m.url,
          caption: i === 0 && captionFits ? text : undefined,
          parse_mode: i === 0 && captionFits ? parseMode : undefined,
        })),
      });
      firstMessageId = msgs[0].message_id;
      if (!captionFits && text) await call(token, "sendMessage", { chat_id: chatId, text, parse_mode: parseMode, disable_notification: silent });
    }

    return { platformPostId: `${chatId}:${firstMessageId}`, url: messageUrl(String(chatId), ctx.account.username, firstMessageId) };
  },
};
