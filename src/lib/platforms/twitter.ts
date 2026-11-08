import type { OAuthAdapter, MediaItem } from "./types";
import { PlatformError, basicAuth, downloadMedia, expiresIn, fetchJson, form, sleep } from "./http";

const API = "https://api.x.com/2";
const SCOPES = ["tweet.read", "tweet.write", "users.read", "offline.access", "media.write"];
const CHUNK = 4 * 1024 * 1024;

/** X counts every URL as 23 characters. This is close enough for validation. */
function weightedLength(text: string): number {
  return [...text.replace(/https?:\/\/\S+/g, "x".repeat(23))].length;
}

async function uploadImage(token: string, item: MediaItem): Promise<string> {
  const file = await downloadMedia(item.url, 5 * 1024 * 1024);
  const body = new FormData();
  body.append("media", new Blob([new Uint8Array(file.buffer)], { type: file.contentType }), file.filename);
  body.append("media_category", file.contentType === "image/gif" ? "tweet_gif" : "tweet_image");
  body.append("media_type", file.contentType);
  const res = await fetchJson<any>(`${API}/media/upload`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}` },
    body,
    label: "X image upload",
  });
  const id = res?.data?.id ?? res?.media_id_string;
  if (!id) throw new PlatformError(`X image upload returned no media id: ${JSON.stringify(res).slice(0, 300)}`);
  return String(id);
}

async function uploadVideo(token: string, item: MediaItem): Promise<string> {
  const file = await downloadMedia(item.url, 512 * 1024 * 1024);
  const auth = { Authorization: `Bearer ${token}` };
  const init = await fetchJson<any>(`${API}/media/upload/initialize`, {
    method: "POST",
    headers: { ...auth, "Content-Type": "application/json" },
    body: JSON.stringify({ media_type: file.contentType || "video/mp4", total_bytes: file.size, media_category: "tweet_video" }),
    label: "X video init",
  });
  const id = String(init.data.id);
  for (let i = 0, offset = 0; offset < file.size; i++, offset += CHUNK) {
    const body = new FormData();
    body.append("media", new Blob([new Uint8Array(file.buffer.subarray(offset, offset + CHUNK))]), "chunk");
    body.append("segment_index", String(i));
    const res = await fetch(`${API}/media/upload/${id}/append`, { method: "POST", headers: auth, body });
    if (!res.ok) throw new PlatformError(`X video upload failed (${res.status}): ${(await res.text()).slice(0, 300)}`, { retryable: res.status >= 500 });
  }
  const fin = await fetchJson<any>(`${API}/media/upload/${id}/finalize`, { method: "POST", headers: auth, label: "X video finalize" });
  let info = fin?.data?.processing_info;
  for (let tries = 0; info && info.state !== "succeeded" && tries < 60; tries++) {
    if (info.state === "failed") throw new PlatformError(`X could not process the video: ${JSON.stringify(info.error ?? info)}`);
    await sleep(Math.max(1, info.check_after_secs ?? 3) * 1000);
    const status = await fetchJson<any>(`${API}/media/upload?${new URLSearchParams({ command: "STATUS", media_id: id })}`, {
      headers: auth,
      label: "X video status",
    });
    info = status?.data?.processing_info;
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
    const mediaIds = video
      ? [await uploadVideo(token, video)]
      : await Promise.all(ctx.media.filter((m) => m.type === "image").slice(0, 4).map((m) => uploadImage(token, m)));

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
};
