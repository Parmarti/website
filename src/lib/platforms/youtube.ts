import type { OAuthAdapter, PostMetrics, TokenSet } from "./types";
import { PlatformError, downloadMedia, expiresIn, fetchJson, form, str, bool, num } from "./http";

const SCOPES = [
  "https://www.googleapis.com/auth/youtube.upload",
  "https://www.googleapis.com/auth/youtube.readonly",
];

const TOKEN_URL = "https://oauth2.googleapis.com/token";

interface GoogleToken {
  access_token: string;
  refresh_token?: string;
  expires_in?: number;
}

function titleFrom(content: string, options: Record<string, unknown>): string {
  const explicit = str(options.title);
  const firstLine = content.split("\n").find((l) => l.trim().length > 0)?.trim() ?? "";
  return (explicit ?? firstLine ?? "Untitled").slice(0, 100) || "Untitled";
}

export const youtubeAdapter: OAuthAdapter = {
  id: "youtube",
  name: "YouTube",
  kind: "oauth",
  maxChars: 5000,
  maxImages: 0,
  supportsVideo: true,
  supportsText: false,
  requiresMedia: true,
  setupNote:
    "Needs a Google Cloud project with the YouTube Data API and an OAuth consent screen. Unverified apps are limited to 100 test users, and videos uploaded from an unaudited API project stay private until Google approves an audit.",

  validate({ content, media, options }) {
    const problems: string[] = [];
    const videos = media.filter((m) => m.type === "video");
    if (videos.length !== 1 || media.length !== 1) problems.push("YouTube needs exactly one video.");
    if (content.length > 5000) problems.push("YouTube descriptions are limited to 5000 characters.");
    const title = str(options.title);
    if (title && title.length > 100) problems.push("YouTube titles are limited to 100 characters.");
    if (!title && !content.trim()) problems.push("YouTube needs a title (options.title) or post text.");
    const visibility = options.visibility;
    if (visibility !== undefined && !["public", "unlisted", "private"].includes(String(visibility))) {
      problems.push("YouTube visibility must be public, unlisted or private.");
    }
    if (options.tags !== undefined && (!Array.isArray(options.tags) || options.tags.some((t) => typeof t !== "string"))) {
      problems.push("YouTube tags must be an array of strings.");
    }
    return problems;
  },

  getAuthUrl({ app, redirectUri, state }) {
    const params = new URLSearchParams({
      client_id: app.clientId,
      redirect_uri: redirectUri,
      response_type: "code",
      scope: SCOPES.join(" "),
      access_type: "offline",
      prompt: "consent",
      include_granted_scopes: "true",
      state,
    });
    return `https://accounts.google.com/o/oauth2/v2/auth?${params}`;
  },

  async exchangeCode({ app, code, redirectUri }) {
    const token = await fetchJson<GoogleToken>(TOKEN_URL, {
      method: "POST",
      label: "Google token exchange",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: form({
        code,
        client_id: app.clientId,
        client_secret: app.clientSecret,
        redirect_uri: redirectUri,
        grant_type: "authorization_code",
      }),
    });
    const channels = await fetchJson<{ items?: any[] }>(
      "https://www.googleapis.com/youtube/v3/channels?part=snippet&mine=true",
      { label: "YouTube channel lookup", headers: { Authorization: `Bearer ${token.access_token}` } },
    );
    const channel = channels.items?.[0];
    if (!channel) throw new PlatformError("This Google account has no YouTube channel.");
    const snippet = channel.snippet ?? {};
    return [
      {
        platformAccountId: channel.id,
        username: snippet.customUrl ?? null,
        displayName: snippet.title ?? null,
        avatarUrl: snippet.thumbnails?.default?.url ?? null,
        metadata: { channelId: channel.id },
        token: {
          accessToken: token.access_token,
          refreshToken: token.refresh_token ?? null,
          expiresAt: expiresIn(token.expires_in),
        },
      },
    ];
  },

  async refresh({ app, refreshToken }): Promise<TokenSet> {
    if (!refreshToken) throw new PlatformError("YouTube account has no refresh token. Reconnect it.", { auth: true });
    let token: GoogleToken;
    try {
      token = await fetchJson<GoogleToken>(TOKEN_URL, {
        method: "POST",
        label: "Google token refresh",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: form({
          client_id: app.clientId,
          client_secret: app.clientSecret,
          refresh_token: refreshToken,
          grant_type: "refresh_token",
        }),
      });
    } catch (err) {
      if (err instanceof PlatformError && err.opts.status === 400) {
        throw new PlatformError(`YouTube refresh token was rejected. Reconnect the account. ${err.message}`, { auth: true });
      }
      throw err;
    }
    return {
      accessToken: token.access_token,
      refreshToken: token.refresh_token ?? refreshToken,
      expiresAt: expiresIn(token.expires_in),
    };
  },

  async publish({ accessToken, content, media, options }) {
    if (!accessToken) throw new PlatformError("YouTube account has no access token.", { auth: true });
    const video = media.find((m) => m.type === "video");
    if (!video) throw new PlatformError("YouTube needs a video.");

    const file = await downloadMedia(video.url);
    const contentType = file.contentType.startsWith("video/") ? file.contentType : "video/*";
    const privacy = ["public", "unlisted", "private"].includes(String(options.visibility))
      ? String(options.visibility)
      : "public";
    const tags = Array.isArray(options.tags) ? options.tags.filter((t): t is string => typeof t === "string") : undefined;

    const metadata = {
      snippet: {
        title: titleFrom(content, options),
        description: content.slice(0, 5000),
        tags,
        categoryId: str(options.categoryId) ?? (typeof options.categoryId === "number" ? String(options.categoryId) : "22"),
      },
      status: {
        privacyStatus: privacy,
        selfDeclaredMadeForKids: bool(options.madeForKids) ?? false,
      },
    };

    let init: Response;
    try {
      init = await fetch(
        "https://www.googleapis.com/upload/youtube/v3/videos?uploadType=resumable&part=snippet,status",
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${accessToken}`,
            "Content-Type": "application/json; charset=UTF-8",
            "X-Upload-Content-Type": contentType,
            "X-Upload-Content-Length": String(file.size),
          },
          body: JSON.stringify(metadata),
          signal: AbortSignal.timeout(60_000),
        },
      );
    } catch (err) {
      throw new PlatformError(`YouTube upload start failed: ${(err as Error).message}`, { retryable: true });
    }
    if (!init.ok) {
      const body = await init.text();
      throw new PlatformError(`YouTube upload start failed (${init.status}): ${body.slice(0, 500)}`, {
        status: init.status,
        auth: init.status === 401,
        retryable: init.status === 429 || init.status >= 500,
      });
    }
    const uploadUrl = init.headers.get("location");
    if (!uploadUrl) throw new PlatformError("YouTube did not return an upload URL.", { retryable: true });

    const uploaded = await fetchJson<{ id: string }>(uploadUrl, {
      method: "PUT",
      label: "YouTube video upload",
      headers: { "Content-Type": contentType, "Content-Length": String(file.size) },
      body: new Uint8Array(file.buffer),
      signal: AbortSignal.timeout(30 * 60_000),
    });
    if (!uploaded?.id) throw new PlatformError("YouTube upload did not return a video id.", { retryable: true });
    return { platformPostId: uploaded.id, url: `https://www.youtube.com/watch?v=${uploaded.id}` };
  },
  analytics: {
    postBatchSize: 50,
    note: "Reads public video statistics with the youtube.readonly scope.",
    async fetchPostMetrics(ctx, ids) {
      const res = await fetchJson<{ items?: any[] }>(
        `https://www.googleapis.com/youtube/v3/videos?${new URLSearchParams({ part: "statistics", id: ids.join(",") })}`,
        { headers: { Authorization: `Bearer ${ctx.accessToken}` }, label: "YouTube video statistics" },
      );
      const out: Record<string, PostMetrics> = {};
      for (const v of res.items ?? []) {
        const s = v.statistics ?? {};
        out[String(v.id)] = { views: num(s.viewCount), likes: num(s.likeCount), comments: num(s.commentCount) };
      }
      return out;
    },
    async fetchAccountMetrics(ctx) {
      const res = await fetchJson<{ items?: any[] }>("https://www.googleapis.com/youtube/v3/channels?part=statistics&mine=true", {
        headers: { Authorization: `Bearer ${ctx.accessToken}` },
        label: "YouTube channel statistics",
      });
      const s = res.items?.[0]?.statistics ?? {};
      return { followers: s.hiddenSubscriberCount ? null : num(s.subscriberCount), posts: num(s.videoCount) };
    },
  },
};
