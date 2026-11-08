import type { OAuthAdapter, MediaItem, PostMetrics } from "./types";
import { PlatformError, basicAuth, downloadMedia, expiresIn, fetchJson, form, num, sleep } from "./http";

const API = "https://api.x.com/2";
const SCOPES = ["tweet.read", "tweet.write", "users.read", "offline.access", "media.write"];
const CHUNK = 4 * 1024 * 1024;

/** X counts every URL as 23 characters. This is close enough for validation. */
function weightedLength(text: string): number {
  return [...text.replace(/https?:\/\/\S+/g, "x".repeat(23))].length;
}

type MediaCategory = "tweet_image" | "tweet_gif" | "tweet_video";

/** X API v2 chunked upload (initialize, append, finalize, then poll status). Used for images and video. */
async function uploadMedia(token: string, item: MediaItem): Promise<string> {
  const isVideo = item.type === "video";
  const file = await downloadMedia(item.url, isVideo ? 512 * 1024 * 1024 : 15 * 1024 * 1024);
  const category: MediaCategory = isVideo ? "tweet_video" : file.contentType === "image/gif" ? "tweet_gif" : "tweet_image";
  if (category === "tweet_image" && file.size > 5 * 1024 * 1024) throw new PlatformError("X images must be 5 MB or smaller.");
  const auth = { Authorization: `Bearer ${token}` };

  const init = await fetchJson<any>(`${API}/media/upload/initialize`, {
    method: "POST",
    headers: { ...auth, "Content-Type": "application/json" },
    body: JSON.stringify({
      media_type: file.contentType || (isVideo ? "video/mp4" : "image/jpeg"),
      total_bytes: file.size,
      media_category: category,
    }),
    label: "X media init",
  });
  const id = String(init?.data?.id ?? "");
  if (!id) throw new PlatformError(`X media init returned no id: ${JSON.stringify(init).slice(0, 300)}`);

  for (let i = 0, offset = 0; offset < file.size; i++, offset += CHUNK) {
    const body = new FormData();
    body.append("media", new Blob([new Uint8Array(file.buffer.subarray(offset, offset + CHUNK))]), "chunk");
    body.append("segment_index", String(i));
    let res: Response;
    try {
      res = await fetch(`${API}/media/upload/${id}/append`, { method: "POST", headers: auth, body, signal: AbortSignal.timeout(120_000) });
    } catch (err) {
      throw new PlatformError(`X media upload failed: ${(err as Error).message}`, { retryable: true });
    }
    if (!res.ok) {
      throw new PlatformError(`X media upload failed (${res.status}): ${(await res.text()).slice(0, 300)}`, {
        status: res.status,
        retryable: res.status === 429 || res.status >= 500,
        auth: res.status === 401,
      });
    }
  }

  const fin = await fetchJson<any>(`${API}/media/upload/${id}/finalize`, { method: "POST", headers: auth, label: "X media finalize" });
  let info = fin?.data?.processing_info;
  for (let tries = 0; info && info.state !== "succeeded"; tries++) {
    if (info.state === "failed") throw new PlatformError(`X could not process the media: ${JSON.stringify(info.error ?? info)}`);
    if (tries >= 60) throw new PlatformError("X media processing took too long.", { retryable: true });
    await sleep(Math.max(1, info.check_after_secs ?? 3) * 1000);
    const status = await fetchJson<any>(`${API}/media/upload?${new URLSearchParams({ command: "STATUS", media_id: id })}`, {
      headers: auth,
      label: "X media status",
    });
    info = status?.data?.processing_info;
  }

  if (item.altText && !isVideo) {
    await fetchJson(`${API}/media/metadata`, {
      method: "POST",
      headers: { ...auth, "Content-Type": "application/json" },
      body: JSON.stringify({ id, metadata: { alt_text: { text: item.altText.slice(0, 1000) } } }),
      label: "X alt text",
    }).catch((err) => console.warn("[twitter] alt text failed", (err as Error).message));
  }
  return id;
}

async function postTweet(token: string, body: Record<string, unknown>) {
  try {
    const res = await fetchJson<any>(`${API}/tweets`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify(body),
      label: "X post",
    });
    return String(res.data.id);
  } catch (err) {
    if (err instanceof PlatformError && err.opts.status === 403) {
      throw new PlatformError(`X refused the post (403). Duplicate text, missing write access, or no API credit. ${err.message}`, err.opts);
    }
    throw err;
  }
}

export const twitterAdapter: OAuthAdapter = {
  id: "twitter",
  name: "X (Twitter)",
  kind: "oauth",
  usesPkce: true,
  maxChars: 280,
  maxImages: 4,
  supportsVideo: true,
  supportsText: true,
  setupNote:
    "Needs an X developer app with OAuth 2.0 enabled (type: Web App) and a paid API plan or pay-per-use credit. Customers can bring their own X app so usage is billed to them.",
  validate({ content, media, options }) {
    const problems: string[] = [];
    if (options.allowLongPost !== true && weightedLength(content) > 280) problems.push("X posts are limited to 280 characters (set allowLongPost for Premium accounts).");
    const videos = media.filter((m) => m.type === "video").length;
    if (media.length > 4) problems.push("X allows at most 4 images.");
    if (videos > 1 || (videos === 1 && media.length > 1)) problems.push("X posts can have one video or up to 4 images.");
    if (options.threadItems !== undefined && !Array.isArray(options.threadItems)) problems.push("threadItems must be an array of strings.");
    return problems;
  },
  getAuthUrl({ app, redirectUri, state, codeChallenge }) {
    const params = new URLSearchParams({
      response_type: "code",
      client_id: app.clientId,
      redirect_uri: redirectUri,
      scope: SCOPES.join(" "),
      state,
      code_challenge: codeChallenge!,
      code_challenge_method: "S256",
    });
    return `https://x.com/i/oauth2/authorize?${params}`;
  },
  async exchangeCode({ app, code, redirectUri, codeVerifier }) {
    const token = await fetchJson<any>(`${API}/oauth2/token`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded", Authorization: basicAuth(app.clientId, app.clientSecret) },
      body: form({ grant_type: "authorization_code", code, redirect_uri: redirectUri, code_verifier: codeVerifier, client_id: app.clientId }),
      label: "X token exchange",
    });
    const me = await fetchJson<any>(`${API}/users/me?user.fields=profile_image_url,username,name`, {
      headers: { Authorization: `Bearer ${token.access_token}` },
      label: "X profile",
    });
    return [
      {
        platformAccountId: me.data.id,
        username: me.data.username,
        displayName: me.data.name,
        avatarUrl: me.data.profile_image_url ?? null,
        token: { accessToken: token.access_token, refreshToken: token.refresh_token ?? null, expiresAt: expiresIn(token.expires_in) },
      },
    ];
  },
  async refresh({ app, refreshToken }) {
    if (!refreshToken) throw new PlatformError("X access expired. Reconnect the account.", { auth: true });
    try {
      const token = await fetchJson<any>(`${API}/oauth2/token`, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded", Authorization: basicAuth(app.clientId, app.clientSecret) },
        body: form({ grant_type: "refresh_token", refresh_token: refreshToken, client_id: app.clientId }),
        label: "X token refresh",
      });
      return { accessToken: token.access_token, refreshToken: token.refresh_token ?? refreshToken, expiresAt: expiresIn(token.expires_in) };
    } catch (err) {
      if (err instanceof PlatformError && err.opts.status === 400) {
        throw new PlatformError("X access was revoked or expired. Reconnect the account.", { auth: true });
      }
      throw err;
    }
  },
  async publish(ctx) {
    const token = ctx.accessToken;
    if (!token) throw new PlatformError("Missing X token. Reconnect the account.", { auth: true });

    const video = ctx.media.find((m) => m.type === "video");
    const mediaIds: string[] = [];
    for (const item of video ? [video] : ctx.media.filter((m) => m.type === "image").slice(0, 4)) {
      mediaIds.push(await uploadMedia(token, item));
    }

    const firstId = await postTweet(token, {
      text: ctx.content,
      ...(mediaIds.length ? { media: { media_ids: mediaIds } } : {}),
      ...(typeof ctx.options.replyToId === "string" ? { reply: { in_reply_to_tweet_id: ctx.options.replyToId } } : {}),
    });

    // Optional thread: each extra item is posted as a reply to the previous one.
    let previous = firstId;
    if (Array.isArray(ctx.options.threadItems)) {
      for (const item of ctx.options.threadItems) {
        if (typeof item !== "string" || !item.trim()) continue;
        previous = await postTweet(token, { text: item, reply: { in_reply_to_tweet_id: previous } });
      }
    }

    const handle = ctx.account.username || "i";
    return { platformPostId: firstId, url: `https://x.com/${handle}/status/${firstId}` };
  },
  analytics: {
    postBatchSize: 100,
    note: "Reads public metrics with tweet.read. Each read counts toward your X API usage.",
    async fetchPostMetrics(ctx, ids) {
      const res = await fetchJson<any>(`${API}/tweets?${new URLSearchParams({ ids: ids.join(","), "tweet.fields": "public_metrics" })}`, {
        headers: { Authorization: `Bearer ${ctx.accessToken}` },
        label: "X post metrics",
      });
      const out: Record<string, PostMetrics> = {};
      for (const t of res?.data ?? []) {
        const m = t.public_metrics ?? {};
        out[String(t.id)] = {
          impressions: num(m.impression_count),
          likes: num(m.like_count),
          comments: num(m.reply_count),
          shares: num(m.retweet_count),
          quotes: num(m.quote_count),
          saves: num(m.bookmark_count),
        };
      }
      return out;
    },
    async fetchAccountMetrics(ctx) {
      const res = await fetchJson<any>(`${API}/users/me?user.fields=public_metrics`, {
        headers: { Authorization: `Bearer ${ctx.accessToken}` },
        label: "X account metrics",
      });
      const m = res?.data?.public_metrics ?? {};
      return { followers: num(m.followers_count), following: num(m.following_count), posts: num(m.tweet_count) };
    },
  },
};
