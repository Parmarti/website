import type { OAuthAdapter } from "./types";
import { expiresIn, form, PlatformError, str } from "./http";
import { metaJson, requireToken, waitForMetaContainer } from "./facebook";

const VER = process.env.META_GRAPH_VERSION || "v23.0";
const GRAPH = `https://graph.instagram.com/${VER}`;
const SCOPES = ["instagram_business_basic", "instagram_business_content_publish"];
const CONTENT_TYPES = ["post", "reel", "story"];

export const instagramAdapter: OAuthAdapter = {
  id: "instagram",
  name: "Instagram",
  kind: "oauth",
  maxChars: 2200,
  maxImages: 10,
  supportsVideo: true,
  supportsText: false,
  requiresMedia: true,
  setupNote:
    "Needs a Meta app with the Instagram API (Instagram Login) product. Only Instagram professional accounts (Business or Creator) can publish. Works right away for Instagram testers added to the app; public use needs Meta App Review for instagram_business_basic and instagram_business_content_publish.",

  getAuthUrl({ app, redirectUri, state }) {
    const params = new URLSearchParams({
      client_id: app.clientId,
      redirect_uri: redirectUri,
      response_type: "code",
      scope: SCOPES.join(","),
      state,
    });
    return `https://www.instagram.com/oauth/authorize?${params}`;
  },

  async exchangeCode({ app, code, redirectUri }) {
    const raw = await metaJson<any>("https://api.instagram.com/oauth/access_token", {
      method: "POST",
      // Instagram sometimes appends "#_" to the code in the redirect.
      body: form({
        client_id: app.clientId,
        client_secret: app.clientSecret,
        grant_type: "authorization_code",
        redirect_uri: redirectUri,
        code: code.replace(/#_$/, ""),
      }),
      label: "Instagram token exchange",
    });
    // The response is either { access_token, user_id } or { data: [{ access_token, user_id }] }.
    const short = Array.isArray(raw?.data) ? raw.data[0] : raw;
    if (!short?.access_token) throw new PlatformError("Instagram did not return an access token.");

    const long = await metaJson<{ access_token: string; expires_in?: number }>(
      `https://graph.instagram.com/access_token?${new URLSearchParams({
        grant_type: "ig_exchange_token",
        client_secret: app.clientSecret,
        access_token: short.access_token,
      })}`,
      { label: "Instagram long-lived token" },
    );

    const me = await metaJson<{
      user_id?: string | number;
      id?: string | number;
      username?: string;
      name?: string;
      profile_picture_url?: string;
    }>(
      `${GRAPH}/me?${new URLSearchParams({ fields: "user_id,username,name,profile_picture_url", access_token: long.access_token })}`,
      { label: "Instagram profile" },
    );
    const igId = String(me.user_id ?? me.id ?? short.user_id);

    return [
      {
        platformAccountId: igId,
        username: me.username ?? null,
        displayName: me.name || me.username || null,
        avatarUrl: me.profile_picture_url ?? null,
        metadata: {},
        token: { accessToken: long.access_token, refreshToken: null, expiresAt: expiresIn(long.expires_in) },
      },
    ];
  },

  // Long-lived Instagram tokens are refreshed with the token itself (it must be at least 24 hours old).
  async refresh({ accessToken }) {
    const res = await metaJson<{ access_token: string; expires_in?: number }>(
      `https://graph.instagram.com/refresh_access_token?${new URLSearchParams({
        grant_type: "ig_refresh_token",
        access_token: accessToken,
      })}`,
      { label: "Instagram token refresh" },
    );
    return { accessToken: res.access_token, refreshToken: null, expiresAt: expiresIn(res.expires_in) };
  },

  validate({ content, media, options }) {
    const errors: string[] = [];
    const contentType = str(options.contentType);
    if (contentType && !CONTENT_TYPES.includes(contentType)) {
      errors.push(`Instagram contentType must be one of: ${CONTENT_TYPES.join(", ")}.`);
    }
    if (media.length === 0) errors.push("Instagram posts need at least one image or video.");
    if (media.length > 10) errors.push("Instagram carousels can have at most 10 items.");
    if (contentType === "story" && media.length !== 1) errors.push("Instagram stories take exactly one image or video.");
    if (contentType === "reel" && (media.length !== 1 || media[0].type !== "video")) {
      errors.push("Instagram reels take exactly one video.");
    }
    if (content.length > 2200) errors.push("Instagram captions are limited to 2,200 characters.");
    if ((content.match(/#[\p{L}\p{N}_]+/gu) ?? []).length > 30) errors.push("Instagram allows at most 30 hashtags.");
    return errors;
  },

  async publish(ctx) {
    const token = requireToken(ctx, "Instagram");
    const igId = ctx.account.platformAccountId;
    const caption = ctx.content.trim() ? ctx.content : undefined;
    const media = ctx.media;
    if (media.length === 0) throw new PlatformError("Instagram posts need at least one image or video.");

    const statusUrl = (id: string) =>
      `${GRAPH}/${id}?${new URLSearchParams({ fields: "status_code,status", access_token: token })}`;

    const createContainer = async (params: Record<string, string | undefined>) => {
      const res = await metaJson<{ id: string }>(`${GRAPH}/${igId}/media`, {
        method: "POST",
        body: form({ ...params, access_token: token }),
        label: "Instagram create media",
      });
      return res.id;
    };

    let creationId: string;
    if (str(ctx.options.contentType) === "story") {
      const m = media[0];
      creationId = await createContainer(
        m.type === "video" ? { media_type: "STORIES", video_url: m.url } : { media_type: "STORIES", image_url: m.url },
      );
    } else if (media.length === 1) {
      const m = media[0];
      if (m.type === "video") {
        const shareToFeed = ctx.options.shareToFeed !== false;
        const thumbOffset = ctx.options.thumbOffset;
        creationId = await createContainer({
          media_type: "REELS",
          video_url: m.url,
          caption,
          share_to_feed: shareToFeed ? "true" : "false",
          cover_url: str(ctx.options.coverUrl),
          thumb_offset: typeof thumbOffset === "number" ? String(thumbOffset) : undefined,
        });
      } else {
        creationId = await createContainer({ image_url: m.url, caption });
      }
    } else {
      const children: string[] = [];
      for (const m of media) {
        children.push(
          await createContainer(
            m.type === "video"
              ? { media_type: "VIDEO", video_url: m.url, is_carousel_item: "true" }
              : { image_url: m.url, is_carousel_item: "true" },
          ),
        );
      }
      for (const child of children) await waitForMetaContainer(statusUrl(child), "status_code", "Instagram");
      creationId = await createContainer({ media_type: "CAROUSEL", children: children.join(","), caption });
    }

    await waitForMetaContainer(statusUrl(creationId), "status_code", "Instagram");

    const published = await metaJson<{ id: string }>(`${GRAPH}/${igId}/media_publish`, {
      method: "POST",
      body: form({ creation_id: creationId, access_token: token }),
      label: "Instagram publish",
    });

    let url: string | null = null;
    try {
      const info = await metaJson<{ permalink?: string }>(
        `${GRAPH}/${published.id}?${new URLSearchParams({ fields: "permalink", access_token: token })}`,
        { label: "Instagram permalink" },
      );
      url = info.permalink ?? null;
    } catch {
      /* best effort */
    }

    // Needs the instagram_business_manage_comments permission; skipped quietly when missing.
    const firstComment = str(ctx.options.firstComment);
    if (firstComment) {
      try {
        await metaJson(`${GRAPH}/${published.id}/comments`, {
          method: "POST",
          body: form({ message: firstComment, access_token: token }),
          label: "Instagram first comment",
        });
      } catch (err) {
        console.warn("[instagram] first comment failed", (err as Error).message);
      }
    }

    return { platformPostId: published.id, url };
  },
};
