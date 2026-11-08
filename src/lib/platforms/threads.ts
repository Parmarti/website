import type { AccountMetrics, OAuthAdapter, PostMetrics } from "./types";
import { expiresIn, form, graphemeLength, PlatformError, str } from "./http";
import { insightValue, isMetaNotFound, metaJson, requireToken, waitForMetaContainer } from "./facebook";

const API = "https://graph.threads.net/v1.0";
const SCOPES = ["threads_basic", "threads_content_publish", "threads_manage_insights"];
const MAX_CHARS = 500;

export const threadsAdapter: OAuthAdapter = {
  id: "threads",
  name: "Threads",
  kind: "oauth",
  maxChars: MAX_CHARS,
  maxImages: 20,
  supportsVideo: true,
  supportsText: true,
  setupNote:
    "Needs a Meta app with the Threads API use case. Works right away for Threads testers added to the app; public use needs Meta App Review for threads_basic and threads_content_publish.",

  getAuthUrl({ app, redirectUri, state }) {
    const params = new URLSearchParams({
      client_id: app.clientId,
      redirect_uri: redirectUri,
      scope: SCOPES.join(","),
      response_type: "code",
      state,
    });
    return `https://threads.net/oauth/authorize?${params}`;
  },

  async exchangeCode({ app, code, redirectUri }) {
    const short = await metaJson<{ access_token: string; user_id?: string | number }>(
      "https://graph.threads.net/oauth/access_token",
      {
        method: "POST",
        body: form({
          client_id: app.clientId,
          client_secret: app.clientSecret,
          code: code.replace(/#_$/, ""),
          grant_type: "authorization_code",
          redirect_uri: redirectUri,
        }),
        label: "Threads token exchange",
      },
    );
    const long = await metaJson<{ access_token: string; expires_in?: number }>(
      `https://graph.threads.net/access_token?${new URLSearchParams({
        grant_type: "th_exchange_token",
        client_secret: app.clientSecret,
        access_token: short.access_token,
      })}`,
      { label: "Threads long-lived token" },
    );
    const me = await metaJson<{ id: string | number; username?: string; name?: string; threads_profile_picture_url?: string }>(
      `${API}/me?${new URLSearchParams({
        fields: "id,username,name,threads_profile_picture_url",
        access_token: long.access_token,
      })}`,
      { label: "Threads profile" },
    );
    return [
      {
        platformAccountId: String(me.id ?? short.user_id),
        username: me.username ?? null,
        displayName: me.name || me.username || null,
        avatarUrl: me.threads_profile_picture_url ?? null,
        metadata: {},
        token: { accessToken: long.access_token, refreshToken: null, expiresAt: expiresIn(long.expires_in) },
      },
    ];
  },

  // Long-lived Threads tokens are refreshed with the token itself.
  async refresh({ accessToken }) {
    const res = await metaJson<{ access_token: string; expires_in?: number }>(
      `https://graph.threads.net/refresh_access_token?${new URLSearchParams({
        grant_type: "th_refresh_token",
        access_token: accessToken,
      })}`,
      { label: "Threads token refresh" },
    );
    return { accessToken: res.access_token, refreshToken: null, expiresAt: expiresIn(res.expires_in) };
  },

  validate({ content, media, options }) {
    const errors: string[] = [];
    if (!content.trim() && media.length === 0) errors.push("Threads posts need text or media.");
    if (graphemeLength(content) > MAX_CHARS) errors.push(`Threads posts are limited to ${MAX_CHARS} characters.`);
    if (media.length > 20) errors.push("Threads carousels can have at most 20 items.");
    const chain = options.replyChain;
    if (chain !== undefined) {
      if (!Array.isArray(chain) || chain.some((t) => typeof t !== "string" || !t.trim())) {
        errors.push("Threads replyChain must be an array of non-empty strings.");
      } else if (chain.some((t) => graphemeLength(t as string) > MAX_CHARS)) {
        errors.push(`Each Threads reply is limited to ${MAX_CHARS} characters.`);
      }
    }
    return errors;
  },

  async publish(ctx) {
    const token = requireToken(ctx, "Threads");
    const userId = ctx.account.platformAccountId;
    const text = ctx.content.trim() ? ctx.content : undefined;
    const media = ctx.media;

    const create = async (params: Record<string, string | undefined>) => {
      const res = await metaJson<{ id: string }>(`${API}/${userId}/threads`, {
        method: "POST",
        body: form({ ...params, access_token: token }),
        label: "Threads create container",
      });
      return res.id;
    };
    const waitFor = (id: string) =>
      waitForMetaContainer(
        `${API}/${id}?${new URLSearchParams({ fields: "status,error_message", access_token: token })}`,
        "status",
        "Threads",
      );
    const publishContainer = async (id: string) => {
      await waitFor(id);
      const res = await metaJson<{ id: string }>(`${API}/${userId}/threads_publish`, {
        method: "POST",
        body: form({ creation_id: id, access_token: token }),
        label: "Threads publish",
      });
      return res.id;
    };

    let containerId: string;
    if (media.length === 0) {
      if (!text) throw new PlatformError("Threads posts need text or media.");
      containerId = await create({ media_type: "TEXT", text, link_attachment: str(ctx.options.link) });
    } else if (media.length === 1) {
      const m = media[0];
      containerId = await create(
        m.type === "video" ? { media_type: "VIDEO", video_url: m.url, text } : { media_type: "IMAGE", image_url: m.url, text },
      );
    } else {
      const children: string[] = [];
      for (const m of media) {
        children.push(
          await create(
            m.type === "video"
              ? { media_type: "VIDEO", video_url: m.url, is_carousel_item: "true" }
              : { media_type: "IMAGE", image_url: m.url, is_carousel_item: "true" },
          ),
        );
      }
      for (const child of children) await waitFor(child);
      containerId = await create({ media_type: "CAROUSEL", children: children.join(","), text });
    }

    const postId = await publishContainer(containerId);

    let url: string | null = null;
    try {
      const info = await metaJson<{ permalink?: string }>(
        `${API}/${postId}?${new URLSearchParams({ fields: "permalink", access_token: token })}`,
        { label: "Threads permalink" },
      );
      url = info.permalink ?? null;
    } catch {
      /* best effort */
    }

    const chain = Array.isArray(ctx.options.replyChain) ? ctx.options.replyChain : [];
    let parentId = postId;
    for (const item of chain) {
      if (typeof item !== "string" || !item.trim()) continue;
      try {
        const replyContainer = await create({ media_type: "TEXT", text: item, reply_to_id: parentId });
        parentId = await publishContainer(replyContainer);
      } catch (err) {
        console.warn("[threads] reply chain stopped", (err as Error).message);
        break;
      }
    }

    return { platformPostId: postId, url };
  },

  analytics: {
    postBatchSize: 1,
    note: "Needs threads_manage_insights; accounts connected before analytics launched must reconnect. Follower counts need the Threads profile to be linked to Instagram.",

    async fetchPostMetrics(ctx, ids) {
      const token = requireToken(ctx, "Threads");
      const out: Record<string, PostMetrics> = {};
      for (const id of ids) {
        let res: { data?: unknown };
        try {
          res = await metaJson(`${API}/${id}/insights?${new URLSearchParams({ metric: "views,likes,replies,reposts,quotes,shares", access_token: token })}`, {
            label: "Threads post insights",
          });
        } catch (err) {
          if (isMetaNotFound(err)) continue;
          throw err;
        }
        const reposts = insightValue(res.data, "reposts");
        const shares = insightValue(res.data, "shares");
        out[id] = {
          views: insightValue(res.data, "views"),
          likes: insightValue(res.data, "likes"),
          comments: insightValue(res.data, "replies"),
          // Reposts and shares (sent off Threads) both spread the post, so they are counted together as shares.
          shares: reposts === null && shares === null ? null : (reposts ?? 0) + (shares ?? 0),
          quotes: insightValue(res.data, "quotes"),
        };
      }
      return out;
    },

    async fetchAccountMetrics(ctx): Promise<AccountMetrics> {
      const token = requireToken(ctx, "Threads");
      const res = await metaJson<{ data?: unknown }>(
        `${API}/${ctx.account.platformAccountId}/threads_insights?${new URLSearchParams({ metric: "followers_count", access_token: token })}`,
        { label: "Threads account insights" },
      );
      return { followers: insightValue(res.data, "followers_count") };
    },
  },
};
