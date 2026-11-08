import type { AccountMetrics, OAuthAdapter, PostMetrics, TokenSet } from "./types";
import { PlatformError, basicAuth, chunk, expiresIn, fetchJson, form, num, str } from "./http";

const UA = process.env.REDDIT_USER_AGENT || "web:fanout:0.1 (by /u/fanout)";

interface RedditToken {
  access_token: string;
  refresh_token?: string;
  expires_in?: number;
  error?: string;
}

async function tokenRequest(app: { clientId: string; clientSecret: string }, data: Record<string, string>, label: string) {
  const token = await fetchJson<RedditToken>("https://www.reddit.com/api/v1/access_token", {
    method: "POST",
    label,
    headers: {
      Authorization: basicAuth(app.clientId, app.clientSecret),
      "Content-Type": "application/x-www-form-urlencoded",
      "User-Agent": UA,
    },
    body: form(data),
  });
  // Reddit can answer HTTP 200 with { error: "invalid_grant" }.
  if (token.error || !token.access_token) {
    throw new PlatformError(`${label} failed: ${token.error ?? "no access token"}`, { auth: token.error === "invalid_grant" });
  }
  return token;
}

function subredditName(value: unknown): string | undefined {
  return str(value)?.replace(/^\/?r\//i, "").trim() || undefined;
}

export const redditAdapter: OAuthAdapter = {
  id: "reddit",
  name: "Reddit",
  kind: "oauth",
  maxChars: 40000,
  maxImages: 1,
  supportsVideo: false,
  supportsText: true,
  setupNote:
    "Needs a Reddit 'web app' from reddit.com/prefs/apps. Commercial use of the Reddit API needs Reddit's approval, and each post needs a subreddit and a title.",

  validate({ content, media, options }) {
    const problems: string[] = [];
    if (!subredditName(options.subreddit)) problems.push("Reddit needs platformSpecificData.subreddit.");
    const title = str(options.title);
    if (!title) problems.push("Reddit needs platformSpecificData.title.");
    else if (title.length > 300) problems.push("Reddit titles are limited to 300 characters.");
    if (content.length > 40000) problems.push("Reddit text posts are limited to 40000 characters.");
    if (media.length > 1) problems.push("Reddit supports at most one image per post.");
    if (media.some((m) => m.type === "video")) problems.push("Reddit video posts are not supported.");
    if (options.url !== undefined && typeof options.url !== "string") problems.push("Reddit url must be a string.");
    return problems;
  },

  getAuthUrl({ app, redirectUri, state }) {
    const params = new URLSearchParams({
      client_id: app.clientId,
      response_type: "code",
      state,
      redirect_uri: redirectUri,
      duration: "permanent",
      scope: "identity submit read",
    });
    return `https://www.reddit.com/api/v1/authorize?${params}`;
  },

  async exchangeCode({ app, code, redirectUri }) {
    const token = await tokenRequest(
      app,
      { grant_type: "authorization_code", code, redirect_uri: redirectUri },
      "Reddit token exchange",
    );
    const me = await fetchJson<any>("https://oauth.reddit.com/api/v1/me", {
      label: "Reddit user lookup",
      headers: { Authorization: `Bearer ${token.access_token}`, "User-Agent": UA },
    });
    if (!me?.id) throw new PlatformError("Reddit did not return an account id.");
    const icon = typeof me.icon_img === "string" ? me.icon_img.replace(/&amp;/g, "&") : null;
    return [
      {
        platformAccountId: String(me.id),
        username: me.name ?? null,
        displayName: me.subreddit?.title || me.name || null,
        avatarUrl: icon,
        metadata: {},
        token: {
          accessToken: token.access_token,
          refreshToken: token.refresh_token ?? null,
          expiresAt: expiresIn(token.expires_in),
        },
      },
    ];
  },

  async refresh({ app, refreshToken }): Promise<TokenSet> {
    if (!refreshToken) throw new PlatformError("Reddit account has no refresh token. Reconnect it.", { auth: true });
    const token = await tokenRequest(app, { grant_type: "refresh_token", refresh_token: refreshToken }, "Reddit token refresh");
    return {
      accessToken: token.access_token,
      refreshToken: token.refresh_token ?? refreshToken,
      expiresAt: expiresIn(token.expires_in),
    };
  },

  async publish({ accessToken, content, media, options }) {
    if (!accessToken) throw new PlatformError("Reddit account has no access token.", { auth: true });
    const sr = subredditName(options.subreddit);
    const title = str(options.title);
    if (!sr) throw new PlatformError("Reddit needs platformSpecificData.subreddit.");
    if (!title) throw new PlatformError("Reddit needs platformSpecificData.title.");

    const image = media.length === 1 && media[0].type === "image" ? media[0] : undefined;
    const linkUrl = str(options.url) ?? image?.url;
    const data: Record<string, string> = {
      api_type: "json",
      sr,
      title: title.slice(0, 300),
      resubmit: "true",
      kind: linkUrl ? "link" : "self",
    };
    if (linkUrl) data.url = linkUrl;
    else data.text = content;

    const res = await fetchJson<any>("https://oauth.reddit.com/api/submit", {
      method: "POST",
      label: "Reddit submit",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/x-www-form-urlencoded",
        "User-Agent": UA,
      },
      body: form(data),
    });
    const errors: unknown[] = res?.json?.errors ?? [];
    if (errors.length > 0) {
      const text = errors.map((e) => (Array.isArray(e) ? e.join(": ") : String(e))).join("; ");
      const retryable = errors.some((e) => Array.isArray(e) && e[0] === "RATELIMIT");
      throw new PlatformError(`Reddit rejected the post: ${text}`, { retryable });
    }
    const result = res?.json?.data ?? {};
    const id = result.name ?? result.id;
    if (!id) throw new PlatformError("Reddit did not return a post id.", { retryable: true });
    return { platformPostId: String(id), url: result.url ?? null };
  },

  analytics: {
    postBatchSize: 100,
    note: "Needs the read scope; accounts connected before analytics launched must reconnect. Likes show the Reddit score (upvotes minus downvotes).",

    async fetchPostMetrics({ accessToken }, ids) {
      if (!accessToken) throw new PlatformError("Reddit account has no access token.", { auth: true });
      const out: Record<string, PostMetrics> = {};
      for (const batch of chunk(ids, 100)) {
        // /api/info needs fullnames ("t3_<id>"); map them back to the ids we were given.
        const byFullname = new Map(batch.map((id) => [id.startsWith("t3_") ? id : `t3_${id}`, id]));
        const res = await fetchJson<any>(`https://oauth.reddit.com/api/info?${new URLSearchParams({ id: [...byFullname.keys()].join(",") })}`, {
          label: "Reddit post metrics",
          headers: { Authorization: `Bearer ${accessToken}`, "User-Agent": UA },
        });
        for (const child of res?.data?.children ?? []) {
          const d = child?.data ?? {};
          const original = byFullname.get(String(d.name));
          if (!original) continue;
          out[original] = {
            likes: num(d.score),
            comments: num(d.num_comments),
            views: num(d.view_count),
          };
        }
      }
      return out;
    },

    async fetchAccountMetrics({ accessToken }): Promise<AccountMetrics> {
      if (!accessToken) throw new PlatformError("Reddit account has no access token.", { auth: true });
      const me = await fetchJson<any>("https://oauth.reddit.com/api/v1/me", {
        label: "Reddit account metrics",
        headers: { Authorization: `Bearer ${accessToken}`, "User-Agent": UA },
      });
      return { followers: num(me?.subreddit?.subscribers), posts: null };
    },
  },
};
