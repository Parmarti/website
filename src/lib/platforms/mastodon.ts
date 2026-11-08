import type { CredentialAdapter, PostMetrics } from "./types";
import { PlatformError, downloadMedia, fetchJson, num, sleep, str } from "./http";
import { assertPublicUrl } from "../net";

function normalizeInstance(raw: string): string {
  const withProto = /^https?:\/\//.test(raw.trim()) ? raw.trim() : `https://${raw.trim()}`;
  return new URL(withProto).origin;
}

export const mastodonAdapter: CredentialAdapter = {
  id: "mastodon",
  name: "Mastodon",
  kind: "credentials",
  maxChars: 500,
  maxImages: 4,
  supportsVideo: true,
  supportsText: true,
  helpText:
    "On your Mastodon server open Preferences > Development > New application. Give it the scopes read:accounts, write:statuses and write:media, save, then copy 'Your access token'.",
  fields: [
    { name: "instanceUrl", label: "Server", type: "url", placeholder: "mastodon.social" },
    { name: "accessToken", label: "Access token", type: "password" },
  ],
  validate({ content, media, options }) {
    const problems: string[] = [];
    const limit = typeof options.maxChars === "number" ? options.maxChars : 500;
    if (content.length > limit) problems.push(`Mastodon posts are limited to ${limit} characters on most servers.`);
    if (media.length > 4) problems.push("Mastodon allows at most 4 attachments.");
    return problems;
  },
  async verify(fields) {
    if (!fields.instanceUrl || !fields.accessToken) throw new PlatformError("Server and access token are required.");
    const instance = normalizeInstance(fields.instanceUrl);
    await assertPublicUrl(instance);
    const token = fields.accessToken.trim();
    const me = await fetchJson<any>(`${instance}/api/v1/accounts/verify_credentials`, {
      headers: { Authorization: `Bearer ${token}` },
      label: "Mastodon login",
    });
    const host = new URL(instance).host;
    return {
      identity: {
        platformAccountId: `${host}:${me.id}`,
        username: `${me.username}@${host}`,
        displayName: me.display_name || me.username,
        avatarUrl: me.avatar ?? null,
        metadata: { instance, profileUrl: me.url },
      },
      credentials: { instanceUrl: instance, accessToken: token },
    };
  },
  async publish(ctx) {
    const instance = ctx.credentials?.instanceUrl;
    const token = ctx.credentials?.accessToken;
    if (!instance || !token) throw new PlatformError("Missing Mastodon credentials. Reconnect the account.", { auth: true });
    const auth = { Authorization: `Bearer ${token}` };

    const mediaIds: string[] = [];
    for (const item of ctx.media.slice(0, 4)) {
      const file = await downloadMedia(item.url, 100 * 1024 * 1024);
      const body = new FormData();
      body.append("file", new Blob([new Uint8Array(file.buffer)], { type: file.contentType }), file.filename);
      if (item.altText) body.append("description", item.altText);
      let media = await fetchJson<{ id: string; url: string | null }>(`${instance}/api/v2/media`, {
        method: "POST",
        headers: auth,
        body,
        label: "Mastodon media upload",
      });
      // Large files are processed asynchronously; wait until a URL is available.
      for (let i = 0; !media.url && i < 60; i++) {
        await sleep(2000);
        media = await fetchJson(`${instance}/api/v1/media/${media.id}`, { headers: auth, label: "Mastodon media status" });
      }
      mediaIds.push(media.id);
    }

    const status = await fetchJson<{ id: string; url: string }>(`${instance}/api/v1/statuses`, {
      method: "POST",
      headers: { ...auth, "Content-Type": "application/json", "Idempotency-Key": `${ctx.account.id}:${ctx.content.length}:${Date.now() >> 16}` },
      body: JSON.stringify({
        status: ctx.content,
        media_ids: mediaIds,
        visibility: str(ctx.options.visibility) ?? "public",
        spoiler_text: str(ctx.options.spoilerText),
        sensitive: ctx.options.sensitive === true,
        language: str(ctx.options.language),
      }),
      label: "Mastodon post",
    });
    return { platformPostId: status.id, url: status.url };
  },
  analytics: {
    postBatchSize: 1,
    note: "Reads favourites, boosts and replies with the account's token.",
    async fetchPostMetrics(ctx, ids) {
      const instance = ctx.credentials?.instanceUrl;
      const token = ctx.credentials?.accessToken;
      if (!instance || !token) throw new PlatformError("Missing Mastodon credentials. Reconnect the account.", { auth: true });
      const out: Record<string, PostMetrics> = {};
      for (const id of ids) {
        try {
          const s = await fetchJson<any>(`${instance}/api/v1/statuses/${encodeURIComponent(id)}`, {
            headers: { Authorization: `Bearer ${token}` },
            label: "Mastodon post metrics",
          });
          out[id] = { likes: num(s.favourites_count), shares: num(s.reblogs_count), comments: num(s.replies_count), quotes: num(s.quotes_count) };
        } catch (err) {
          if (err instanceof PlatformError && err.opts.status === 404) continue;
          throw err;
        }
      }
      return out;
    },
    async fetchAccountMetrics(ctx) {
      const instance = ctx.credentials?.instanceUrl;
      const token = ctx.credentials?.accessToken;
      if (!instance || !token) throw new PlatformError("Missing Mastodon credentials. Reconnect the account.", { auth: true });
      const me = await fetchJson<any>(`${instance}/api/v1/accounts/verify_credentials`, { headers: { Authorization: `Bearer ${token}` }, label: "Mastodon account metrics" });
      return { followers: num(me.followers_count), following: num(me.following_count), posts: num(me.statuses_count) };
    },
  },
};
