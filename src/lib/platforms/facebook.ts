import type { ConnectedAccount, OAuthAdapter, PublishContext } from "./types";
import { fetchJson, form, PlatformError, sleep, str } from "./http";

const VER = process.env.META_GRAPH_VERSION || "v23.0";
const GRAPH = `https://graph.facebook.com/${VER}`;
const GRAPH_VIDEO = `https://graph-video.facebook.com/${VER}`;
const SCOPES = ["pages_show_list", "pages_manage_posts", "pages_read_engagement", "business_management"];

/**
 * fetchJson for Meta Graph APIs (Facebook, Instagram, Threads).
 * Meta returns most errors as HTTP 400 with an `error` object, so map its codes:
 * 190/102 = invalid or expired token, 1/2/4/17/32/613 or is_transient = try again later.
 */
export async function metaJson<T = any>(url: string, init: RequestInit & { label?: string } = {}): Promise<T> {
  try {
    return await fetchJson<T>(url, init);
  } catch (err) {
    if (err instanceof PlatformError) {
      const e = (err.opts.body as any)?.error;
      if (e && typeof e === "object") {
        const code = Number(e.code);
        const detail = e.error_user_msg ? ` (${e.error_user_msg})` : "";
        throw new PlatformError(`${init.label ?? "Meta request"} failed: ${e.message ?? "unknown error"}${detail}`, {
          ...err.opts,
          auth: err.opts.auth || code === 190 || code === 102,
          retryable: err.opts.retryable || e.is_transient === true || [1, 2, 4, 17, 32, 613].includes(code),
        });
      }
    }
    throw err;
  }
}

/** Poll a Meta media container (Instagram, Threads) until it is ready to publish. */
export async function waitForMetaContainer(
  statusUrl: string,
  field: "status_code" | "status",
  label: string,
  timeoutMs = 300_000,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const res = await metaJson<Record<string, any>>(statusUrl, { label: `${label} media status` });
    const status = res[field];
    if (status === "FINISHED" || status === "PUBLISHED") return;
    if (status === "ERROR" || status === "EXPIRED") {
      const detail = res.error_message || (field === "status_code" ? res.status : undefined);
      throw new PlatformError(`${label} media processing ${status}${detail ? `: ${detail}` : ""}`);
    }
    if (Date.now() > deadline) {
      throw new PlatformError(`${label} media was still processing after ${Math.round(timeoutMs / 1000)}s`, { retryable: true });
    }
    await sleep(5000);
  }
}

export function requireToken(ctx: PublishContext, platform: string): string {
  if (!ctx.accessToken) throw new PlatformError(`${platform} account has no access token. Reconnect it.`, { auth: true });
  return ctx.accessToken;
}

interface FacebookPage {
  id: string;
  name: string;
  access_token?: string;
  username?: string;
  picture?: { data?: { url?: string } };
}

export const facebookAdapter: OAuthAdapter = {
  id: "facebook",
  name: "Facebook Pages",
  kind: "oauth",
  maxChars: 63206,
  maxImages: 10,
  supportsVideo: true,
  supportsText: true,
  setupNote:
    "Needs a Meta app with Facebook Login. Works right away for people with a role on the app (admins, developers, testers). Public use needs Meta App Review for pages_show_list, pages_manage_posts, pages_read_engagement and business_management, plus Business Verification.",

  getAuthUrl({ app, redirectUri, state }) {
    const params = new URLSearchParams({
      client_id: app.clientId,
      redirect_uri: redirectUri,
      state,
      response_type: "code",
      scope: SCOPES.join(","),
    });
    return `https://www.facebook.com/${VER}/dialog/oauth?${params}`;
  },

  async exchangeCode({ app, code, redirectUri }) {
    const short = await metaJson<{ access_token: string }>(
      `${GRAPH}/oauth/access_token?${new URLSearchParams({
        client_id: app.clientId,
        client_secret: app.clientSecret,
        redirect_uri: redirectUri,
        code,
      })}`,
      { label: "Facebook token exchange" },
    );
    // Page tokens derived from a long-lived user token do not expire.
    const long = await metaJson<{ access_token: string }>(
      `${GRAPH}/oauth/access_token?${new URLSearchParams({
        grant_type: "fb_exchange_token",
        client_id: app.clientId,
        client_secret: app.clientSecret,
        fb_exchange_token: short.access_token,
      })}`,
      { label: "Facebook long-lived token" },
    );
    const pages = await metaJson<{ data?: FacebookPage[] }>(
      `${GRAPH}/me/accounts?${new URLSearchParams({
        fields: "id,name,access_token,picture{url},username",
        limit: "100",
        access_token: long.access_token,
      })}`,
      { label: "Facebook list pages" },
    );
    const usable = (pages.data ?? []).filter((p) => p.access_token);
    if (usable.length === 0) {
      throw new PlatformError(
        "No Facebook Pages were shared. Reconnect and select at least one Page you manage (personal profiles cannot be posted to).",
      );
    }
    return usable.map<ConnectedAccount>((p) => ({
      platformAccountId: p.id,
      username: p.username ?? null,
      displayName: p.name,
      avatarUrl: p.picture?.data?.url ?? null,
      metadata: { pageId: p.id, pageName: p.name },
      token: { accessToken: p.access_token as string, refreshToken: null, expiresAt: null },
    }));
  },

  validate({ content, media, options }) {
    const errors: string[] = [];
    const images = media.filter((m) => m.type === "image");
    const videos = media.filter((m) => m.type === "video");
    if (videos.length > 1) errors.push("Facebook supports one video per post.");
    if (videos.length > 0 && images.length > 0) errors.push("Facebook cannot mix images and video in one post.");
    if (images.length > 10) errors.push("Facebook posts can have at most 10 images.");
    if (!content.trim() && media.length === 0 && !str(options.link)) errors.push("Facebook posts need text, a link or media.");
    if (content.length > 63206) errors.push("Facebook posts are limited to 63,206 characters.");
    return errors;
  },

  async publish(ctx) {
    const token = requireToken(ctx, "Facebook");
    const pageId = ctx.account.platformAccountId;
    const message = ctx.content.trim() ? ctx.content : undefined;
    const images = ctx.media.filter((m) => m.type === "image");
    const videos = ctx.media.filter((m) => m.type === "video");
    let postId: string;
    let url: string;

    if (videos.length > 0) {
      const res = await metaJson<{ id: string }>(`${GRAPH_VIDEO}/${pageId}/videos`, {
        method: "POST",
        body: form({ file_url: videos[0].url, description: message, title: str(ctx.options.title), access_token: token }),
        label: "Facebook video upload",
      });
      postId = res.id;
      url = `https://www.facebook.com/${pageId}/videos/${res.id}`;
    } else if (images.length === 1) {
      const res = await metaJson<{ id: string; post_id?: string }>(`${GRAPH}/${pageId}/photos`, {
        method: "POST",
        body: form({ url: images[0].url, caption: message, access_token: token }),
        label: "Facebook photo post",
      });
      postId = res.post_id ?? res.id;
      url = `https://www.facebook.com/${postId}`;
    } else if (images.length > 1) {
      const mediaIds: string[] = [];
      for (const img of images) {
        const res = await metaJson<{ id: string }>(`${GRAPH}/${pageId}/photos`, {
          method: "POST",
          body: form({ url: img.url, published: "false", access_token: token }),
          label: "Facebook photo upload",
        });
        mediaIds.push(res.id);
      }
      const body = form({ message, access_token: token });
      mediaIds.forEach((id, i) => body.set(`attached_media[${i}]`, JSON.stringify({ media_fbid: id })));
      const res = await metaJson<{ id: string }>(`${GRAPH}/${pageId}/feed`, { method: "POST", body, label: "Facebook multi-photo post" });
      postId = res.id;
      url = `https://www.facebook.com/${postId}`;
    } else {
      const res = await metaJson<{ id: string }>(`${GRAPH}/${pageId}/feed`, {
        method: "POST",
        body: form({ message, link: str(ctx.options.link), access_token: token }),
        label: "Facebook post",
      });
      postId = res.id;
      url = `https://www.facebook.com/${postId}`;
    }

    const firstComment = str(ctx.options.firstComment);
    if (firstComment) {
      try {
        await metaJson(`${GRAPH}/${postId}/comments`, {
          method: "POST",
          body: form({ message: firstComment, access_token: token }),
          label: "Facebook first comment",
        });
      } catch (err) {
        console.warn("[facebook] first comment failed", (err as Error).message);
      }
    }

    return { platformPostId: postId, url };
  },
};
