import type { OAuthAdapter, MediaItem } from "./types";
import { PlatformError, downloadMedia, expiresIn, fetchJson, form, str } from "./http";

const SCOPES = ["openid", "profile", "email", "w_member_social"];

/** LinkedIn versions are YYYYMM and live for about a year. Default to three months ago. */
function apiVersion(): string {
  if (process.env.LINKEDIN_API_VERSION) return process.env.LINKEDIN_API_VERSION;
  const d = new Date();
  d.setUTCDate(1);
  d.setUTCMonth(d.getUTCMonth() - 3);
  return `${d.getUTCFullYear()}${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}

function restHeaders(token: string): Record<string, string> {
  return {
    Authorization: `Bearer ${token}`,
    "LinkedIn-Version": apiVersion(),
    "X-Restli-Protocol-Version": "2.0.0",
    "Content-Type": "application/json",
  };
}

/**
 * LinkedIn "little text" format: reserved characters must be escaped or the post is cut off.
 * Hashtags are turned into the hashtag template so they stay clickable.
 */
export function toLittleText(text: string): string {
  const escaped = text.replace(/[\\|{}@[\]()<>#*_~]/g, (c) => `\\${c}`);
  return escaped.replace(/\\#([\p{L}\p{N}_]+)/gu, (_m, tag: string) => `{hashtag|\\#|${tag.replace(/\\_/g, "_")}}`);
}

async function uploadImage(token: string, owner: string, item: MediaItem): Promise<string> {
  const init = await fetchJson<any>("https://api.linkedin.com/rest/images?action=initializeUpload", {
    method: "POST",
    headers: restHeaders(token),
    body: JSON.stringify({ initializeUploadRequest: { owner } }),
    label: "LinkedIn image init",
  });
  const { uploadUrl, image } = init.value;
  const file = await downloadMedia(item.url, 36 * 1024 * 1024);
  const put = await fetch(uploadUrl, {
    method: "PUT",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": file.contentType },
    body: new Uint8Array(file.buffer),
  });
  if (!put.ok) throw new PlatformError(`LinkedIn image upload failed (${put.status})`, { retryable: put.status >= 500 });
  return image as string;
}

async function uploadVideo(token: string, owner: string, item: MediaItem): Promise<string> {
  const file = await downloadMedia(item.url, 500 * 1024 * 1024);
  const init = await fetchJson<any>("https://api.linkedin.com/rest/videos?action=initializeUpload", {
    method: "POST",
    headers: restHeaders(token),
    body: JSON.stringify({
      initializeUploadRequest: { owner, fileSizeBytes: file.size, uploadCaptions: false, uploadThumbnail: false },
    }),
    label: "LinkedIn video init",
  });
  const { video, uploadInstructions, uploadToken } = init.value;
  const etags: string[] = [];
  for (const part of uploadInstructions as { uploadUrl: string; firstByte: number; lastByte: number }[]) {
    const res = await fetch(part.uploadUrl, {
      method: "PUT",
      headers: { "Content-Type": "application/octet-stream" },
      body: new Uint8Array(file.buffer.subarray(part.firstByte, part.lastByte + 1)),
    });
    if (!res.ok) throw new PlatformError(`LinkedIn video upload failed (${res.status})`, { retryable: res.status >= 500 });
    etags.push(res.headers.get("etag") || "");
  }
  await fetchJson("https://api.linkedin.com/rest/videos?action=finalizeUpload", {
    method: "POST",
    headers: restHeaders(token),
    body: JSON.stringify({ finalizeUploadRequest: { video, uploadToken: uploadToken ?? "", uploadedPartIds: etags } }),
    label: "LinkedIn video finalize",
  });
  return video as string;
}

export const linkedinAdapter: OAuthAdapter = {
  id: "linkedin",
  name: "LinkedIn",
  kind: "oauth",
  maxChars: 3000,
  maxImages: 20,
  supportsVideo: true,
  supportsText: true,
  setupNote:
    "Create an app at developer.linkedin.com and add the products 'Sign In with LinkedIn using OpenID Connect' and 'Share on LinkedIn'. Both are approved instantly, so personal profile posting works on day one.",
  validate({ content, media }) {
    const problems: string[] = [];
    if (content.length > 3000) problems.push("LinkedIn posts are limited to 3000 characters.");
    const videos = media.filter((m) => m.type === "video").length;
    if (videos > 1 || (videos === 1 && media.length > 1)) problems.push("LinkedIn posts can have one video, or up to 20 images, not both.");
    if (media.length > 20) problems.push("LinkedIn allows at most 20 images.");
    return problems;
  },
  getAuthUrl({ app, redirectUri, state }) {
    const params = new URLSearchParams({
      response_type: "code",
      client_id: app.clientId,
      redirect_uri: redirectUri,
      state,
      scope: SCOPES.join(" "),
    });
    return `https://www.linkedin.com/oauth/v2/authorization?${params}`;
  },
  async exchangeCode({ app, code, redirectUri }) {
    const token = await fetchJson<any>("https://www.linkedin.com/oauth/v2/accessToken", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: form({
        grant_type: "authorization_code",
        code,
        redirect_uri: redirectUri,
        client_id: app.clientId,
        client_secret: app.clientSecret,
      }),
      label: "LinkedIn token exchange",
    });
    const me = await fetchJson<any>("https://api.linkedin.com/v2/userinfo", {
      headers: { Authorization: `Bearer ${token.access_token}` },
      label: "LinkedIn profile",
    });
    return [
      {
        platformAccountId: me.sub,
        username: me.email ?? null,
        displayName: me.name ?? [me.given_name, me.family_name].filter(Boolean).join(" "),
        avatarUrl: me.picture ?? null,
        metadata: { authorUrn: `urn:li:person:${me.sub}` },
        token: {
          accessToken: token.access_token,
          refreshToken: token.refresh_token ?? null,
          expiresAt: expiresIn(token.expires_in),
        },
      },
    ];
  },
  async refresh({ app, refreshToken }) {
    if (!refreshToken) {
      throw new PlatformError("LinkedIn access expired (LinkedIn gives most apps 60 day tokens). Reconnect the account.", { auth: true });
    }
    const token = await fetchJson<any>("https://www.linkedin.com/oauth/v2/accessToken", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: form({ grant_type: "refresh_token", refresh_token: refreshToken, client_id: app.clientId, client_secret: app.clientSecret }),
      label: "LinkedIn token refresh",
    });
    return { accessToken: token.access_token, refreshToken: token.refresh_token ?? refreshToken, expiresAt: expiresIn(token.expires_in) };
  },
  async publish(ctx) {
    const token = ctx.accessToken;
    if (!token) throw new PlatformError("Missing LinkedIn token. Reconnect the account.", { auth: true });
    const author = str(ctx.options.organizationUrn) ?? (ctx.account.metadata.authorUrn as string) ?? `urn:li:person:${ctx.account.platformAccountId}`;

    const body: Record<string, unknown> = {
      author,
      commentary: toLittleText(ctx.content),
      visibility: str(ctx.options.visibility) ?? "PUBLIC",
      distribution: { feedDistribution: "MAIN_FEED", targetEntities: [], thirdPartyDistributionChannels: [] },
      lifecycleState: "PUBLISHED",
      isReshareDisabledByAuthor: false,
    };

    const video = ctx.media.find((m) => m.type === "video");
    const images = ctx.media.filter((m) => m.type === "image");
    if (video) {
      const id = await uploadVideo(token, author, video);
      body.content = { media: { id, title: str(ctx.options.title) ?? "" } };
    } else if (images.length === 1) {
      const id = await uploadImage(token, author, images[0]);
      body.content = { media: { id, altText: images[0].altText ?? "" } };
    } else if (images.length > 1) {
      const ids = [];
      for (const img of images) ids.push({ id: await uploadImage(token, author, img), altText: img.altText ?? "" });
      body.content = { multiImage: { images: ids } };
    } else if (str(ctx.options.link)) {
      body.content = {
        article: {
          source: ctx.options.link,
          title: str(ctx.options.linkTitle) ?? (ctx.options.link as string),
          description: str(ctx.options.linkDescription),
        },
      };
    }

    let res: Response;
    try {
      res = await fetch("https://api.linkedin.com/rest/posts", {
        method: "POST",
        headers: restHeaders(token),
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(60_000),
      });
    } catch (err) {
      throw new PlatformError(`LinkedIn post failed: ${(err as Error).message}`, { retryable: true });
    }
    if (!res.ok) {
      const text = await res.text();
      throw new PlatformError(`LinkedIn post failed (${res.status}): ${text.slice(0, 500)}`, {
        status: res.status,
        auth: res.status === 401,
        retryable: res.status === 429 || res.status >= 500,
      });
    }
    const urn = res.headers.get("x-restli-id") || res.headers.get("x-linkedin-id") || "";
    return { platformPostId: urn, url: urn ? `https://www.linkedin.com/feed/update/${urn}/` : null };
  },
};
