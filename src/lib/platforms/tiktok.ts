import type { OAuthAdapter, TokenSet } from "./types";
import { PlatformError, bool, downloadMedia, expiresIn, fetchJson, form, sleep, str } from "./http";

const API = "https://open.tiktokapis.com";
const TOKEN_URL = `${API}/v2/oauth/token/`;
const ONE_CHUNK_MAX = 64 * 1024 * 1024;
const CHUNK_SIZE = 10_000_000;
const PRIVACY_PREFERENCE = ["PUBLIC_TO_EVERYONE", "SELF_ONLY"];

interface TikTokToken {
  access_token?: string;
  refresh_token?: string;
  expires_in?: number;
  open_id?: string;
  error?: string;
  error_description?: string;
}

/** TikTok returns HTTP 200 with { error: { code, message } }; code "ok" means success. */
function checkTikTokError(body: any, label: string) {
  const code = body?.error?.code;
  if (code && code !== "ok") {
    const auth = ["access_token_invalid", "scope_not_authorized", "token_not_authorized_for_specified_scope"].includes(code);
    const retryable = ["rate_limit_exceeded", "internal_error"].includes(code);
    throw new PlatformError(`${label} failed: ${code} ${body.error.message ?? ""}`.trim(), { auth, retryable, body });
  }
}

async function tiktokPost<T = any>(path: string, accessToken: string, payload: unknown, label: string): Promise<T> {
  const body = await fetchJson<any>(`${API}${path}`, {
    method: "POST",
    label,
    headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json; charset=UTF-8" },
    body: JSON.stringify(payload),
  });
  checkTikTokError(body, label);
  return body as T;
}

async function tokenRequest(data: Record<string, string>, label: string): Promise<TikTokToken> {
  const token = await fetchJson<TikTokToken>(TOKEN_URL, {
    method: "POST",
    label,
    headers: { "Content-Type": "application/x-www-form-urlencoded", "Cache-Control": "no-cache" },
    body: form(data),
  });
  // The token endpoint reports errors as { error, error_description } with HTTP 200.
  if (token.error || !token.access_token) {
    throw new PlatformError(`${label} failed: ${token.error ?? "no access token"} ${token.error_description ?? ""}`.trim(), {
      auth: token.error === "invalid_grant",
    });
  }
  return token;
}

export const tiktokAdapter: OAuthAdapter = {
  id: "tiktok",
  name: "TikTok",
  kind: "oauth",
  maxChars: 2200,
  maxImages: 0,
  supportsVideo: true,
  supportsText: false,
  requiresMedia: true,
  setupNote:
    "Needs a TikTok developer app with Login Kit and the Content Posting API. Until TikTok audits the app, posts can only be private (SELF_ONLY).",

  validate({ content, media, options }) {
    const problems: string[] = [];
    if (media.length !== 1 || media[0].type !== "video") problems.push("TikTok needs exactly one video.");
    if (content.length > 2200) problems.push("TikTok captions are limited to 2200 characters.");
    if (options.privacyLevel !== undefined && typeof options.privacyLevel !== "string") {
      problems.push("TikTok privacyLevel must be a string such as PUBLIC_TO_EVERYONE or SELF_ONLY.");
    }
    return problems;
  },

  getAuthUrl({ app, redirectUri, state }) {
    const params = new URLSearchParams({
      client_key: app.clientId,
      scope: "user.info.basic,video.publish,video.upload",
      response_type: "code",
      redirect_uri: redirectUri,
      state,
    });
    return `https://www.tiktok.com/v2/auth/authorize/?${params}`;
  },

  async exchangeCode({ app, code, redirectUri }) {
    const token = await tokenRequest(
      {
        client_key: app.clientId,
        client_secret: app.clientSecret,
        code,
        grant_type: "authorization_code",
        redirect_uri: redirectUri,
      },
      "TikTok token exchange",
    );
    const accessToken = token.access_token!;
    const info = await fetchJson<any>(`${API}/v2/user/info/?fields=open_id,avatar_url,display_name,username`, {
      label: "TikTok user lookup",
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    checkTikTokError(info, "TikTok user lookup");
    const user = info?.data?.user ?? {};
    const openId = user.open_id ?? token.open_id;
    if (!openId) throw new PlatformError("TikTok did not return an account id.");
    return [
      {
        platformAccountId: openId,
        username: user.username ?? null,
        displayName: user.display_name ?? null,
        avatarUrl: user.avatar_url ?? null,
        metadata: {},
        token: {
          accessToken,
          refreshToken: token.refresh_token ?? null,
          expiresAt: expiresIn(token.expires_in),
        },
      },
    ];
  },

  async refresh({ app, refreshToken }): Promise<TokenSet> {
    if (!refreshToken) throw new PlatformError("TikTok account has no refresh token. Reconnect it.", { auth: true });
    const token = await tokenRequest(
      {
        client_key: app.clientId,
        client_secret: app.clientSecret,
        grant_type: "refresh_token",
        refresh_token: refreshToken,
      },
      "TikTok token refresh",
    );
    return {
      accessToken: token.access_token!,
      refreshToken: token.refresh_token ?? refreshToken,
      expiresAt: expiresIn(token.expires_in),
    };
  },

  async publish({ account, accessToken, content, media, options }) {
    if (!accessToken) throw new PlatformError("TikTok account has no access token.", { auth: true });
    const video = media.find((m) => m.type === "video");
    if (!video) throw new PlatformError("TikTok needs a video.");

    const creator = await tiktokPost<any>("/v2/post/publish/creator_info/query/", accessToken, {}, "TikTok creator info");
    const allowed: string[] = creator?.data?.privacy_level_options ?? [];
    const requested = str(options.privacyLevel);
    const privacy =
      (requested && allowed.includes(requested) ? requested : undefined) ??
      PRIVACY_PREFERENCE.find((p) => allowed.includes(p)) ??
      allowed[0];
    if (!privacy) throw new PlatformError("TikTok did not return any allowed privacy levels for this account.");

    const file = await downloadMedia(video.url, 4 * 1024 * 1024 * 1024);
    const size = file.size;
    let chunkSize: number;
    let chunkCount: number;
    if (size <= ONE_CHUNK_MAX) {
      chunkSize = size;
      chunkCount = 1;
    } else {
      chunkSize = CHUNK_SIZE;
      // The last chunk absorbs the remainder (it may be up to 128MB per TikTok rules).
      chunkCount = Math.floor(size / chunkSize);
    }

    const postInfo: Record<string, unknown> = {
      title: content.slice(0, 2200),
      privacy_level: privacy,
      disable_comment: bool(options.disableComment) ?? false,
      disable_duet: bool(options.disableDuet) ?? false,
      disable_stitch: bool(options.disableStitch) ?? false,
    };
    if (typeof options.videoCoverTimestampMs === "number") postInfo.video_cover_timestamp_ms = options.videoCoverTimestampMs;

    const init = await tiktokPost<any>(
      "/v2/post/publish/video/init/",
      accessToken,
      {
        post_info: postInfo,
        source_info: { source: "FILE_UPLOAD", video_size: size, chunk_size: chunkSize, total_chunk_count: chunkCount },
      },
      "TikTok upload init",
    );
    const publishId: string | undefined = init?.data?.publish_id;
    const uploadUrl: string | undefined = init?.data?.upload_url;
    if (!publishId || !uploadUrl) throw new PlatformError("TikTok did not return an upload URL.", { retryable: true });

    for (let i = 0; i < chunkCount; i++) {
      const start = i * chunkSize;
      const end = i === chunkCount - 1 ? size - 1 : start + chunkSize - 1;
      const chunk = file.buffer.subarray(start, end + 1);
      let res: Response;
      try {
        res = await fetch(uploadUrl, {
          method: "PUT",
          headers: {
            "Content-Type": "video/mp4",
            "Content-Length": String(chunk.length),
            "Content-Range": `bytes ${start}-${end}/${size}`,
          },
          body: new Uint8Array(chunk),
          signal: AbortSignal.timeout(10 * 60_000),
        });
      } catch (err) {
        throw new PlatformError(`TikTok chunk upload failed: ${(err as Error).message}`, { retryable: true });
      }
      if (!res.ok) {
        const text = await res.text();
        throw new PlatformError(`TikTok chunk upload failed (${res.status}): ${text.slice(0, 300)}`, {
          status: res.status,
          retryable: res.status >= 500,
        });
      }
    }

    const deadline = Date.now() + 5 * 60_000;
    while (Date.now() < deadline) {
      await sleep(5000);
      const status = await tiktokPost<any>(
        "/v2/post/publish/status/fetch/",
        accessToken,
        { publish_id: publishId },
        "TikTok publish status",
      );
      const data = status?.data ?? {};
      if (data.status === "FAILED") {
        throw new PlatformError(`TikTok publish failed: ${data.fail_reason ?? "unknown reason"}`);
      }
      if (data.status === "PUBLISH_COMPLETE") {
        // The API spells this field "publicaly_available_post_id".
        const publicId = Array.isArray(data.publicaly_available_post_id) ? data.publicaly_available_post_id[0] : undefined;
        if (publicId) {
          const id = String(publicId);
          const url = account.username ? `https://www.tiktok.com/@${account.username}/video/${id}` : null;
          return { platformPostId: id, url };
        }
        return { platformPostId: publishId, url: null };
      }
    }
    // Upload succeeded but processing is still running; report the publish id so the post is not re-uploaded.
    return { platformPostId: publishId, url: null };
  },
};
