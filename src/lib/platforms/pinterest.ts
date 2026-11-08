import type { AccountMetrics, OAuthAdapter, PostMetrics, TokenSet } from "./types";
import { PlatformError, basicAuth, expiresIn, fetchJson, form, num, str } from "./http";

const API = "https://api.pinterest.com/v5";
const SCOPES = "boards:read,boards:write,pins:read,pins:write,user_accounts:read";

interface PinterestToken {
  access_token: string;
  refresh_token?: string;
  expires_in?: number;
}

/** Pinterest pin analytics accept at most a 90 day window ending today. */
function analyticsWindow(now = new Date()) {
  const day = (d: Date) => d.toISOString().slice(0, 10);
  return { start_date: day(new Date(now.getTime() - 89 * 86400_000)), end_date: day(now) };
}

interface Board {
  id: string;
  name: string;
}

async function tokenRequest(app: { clientId: string; clientSecret: string }, data: Record<string, string>, label: string) {
  return fetchJson<PinterestToken>(`${API}/oauth/token`, {
    method: "POST",
    label,
    headers: {
      Authorization: basicAuth(app.clientId, app.clientSecret),
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: form(data),
  });
}

export const pinterestAdapter: OAuthAdapter = {
  id: "pinterest",
  name: "Pinterest",
  kind: "oauth",
  maxChars: 500,
  maxImages: 1,
  supportsVideo: false,
  supportsText: false,
  requiresMedia: true,
  setupNote:
    "Needs a Pinterest developer app. New apps get trial access (pins are visible only to you) until Pinterest approves standard access.",

  validate({ content, media, options }) {
    const problems: string[] = [];
    if (media.length !== 1 || media[0].type !== "image") problems.push("Pinterest needs exactly one image.");
    if (content.length > 500) problems.push("Pinterest descriptions are limited to 500 characters.");
    const title = str(options.title);
    if (title && title.length > 100) problems.push("Pinterest titles are limited to 100 characters.");
    if (options.boardId !== undefined && typeof options.boardId !== "string") problems.push("Pinterest boardId must be a string.");
    if (options.link !== undefined && typeof options.link !== "string") problems.push("Pinterest link must be a URL string.");
    return problems;
  },

  getAuthUrl({ app, redirectUri, state }) {
    const params = new URLSearchParams({
      client_id: app.clientId,
      redirect_uri: redirectUri,
      response_type: "code",
      scope: SCOPES,
      state,
    });
    return `https://www.pinterest.com/oauth/?${params}`;
  },

  async exchangeCode({ app, code, redirectUri }) {
    const token = await tokenRequest(
      app,
      { grant_type: "authorization_code", code, redirect_uri: redirectUri },
      "Pinterest token exchange",
    );
    const headers = { Authorization: `Bearer ${token.access_token}` };
    const user = await fetchJson<any>(`${API}/user_account`, { label: "Pinterest user lookup", headers });
    const boardsRes = await fetchJson<{ items?: any[] }>(`${API}/boards?page_size=100`, {
      label: "Pinterest boards lookup",
      headers,
    });
    const boards: Board[] = (boardsRes.items ?? []).map((b) => ({ id: String(b.id), name: String(b.name ?? "") }));
    const accountId = user.id ?? user.username;
    if (!accountId) throw new PlatformError("Pinterest did not return an account id.");
    return [
      {
        platformAccountId: String(accountId),
        username: user.username ?? null,
        displayName: user.business_name ?? user.username ?? null,
        avatarUrl: user.profile_image ?? null,
        metadata: { boards },
        token: {
          accessToken: token.access_token,
          refreshToken: token.refresh_token ?? null,
          expiresAt: expiresIn(token.expires_in),
        },
      },
    ];
  },

  async refresh({ app, refreshToken }): Promise<TokenSet> {
    if (!refreshToken) throw new PlatformError("Pinterest account has no refresh token. Reconnect it.", { auth: true });
    let token: PinterestToken;
    try {
      token = await tokenRequest(app, { grant_type: "refresh_token", refresh_token: refreshToken }, "Pinterest token refresh");
    } catch (err) {
      if (err instanceof PlatformError && (err.opts.status === 400 || err.opts.status === 401)) {
        throw new PlatformError(`Pinterest refresh token was rejected. Reconnect the account. ${err.message}`, { auth: true });
      }
      throw err;
    }
    return {
      accessToken: token.access_token,
      refreshToken: token.refresh_token ?? refreshToken,
      expiresAt: expiresIn(token.expires_in),
    };
  },

  async publish({ account, accessToken, content, media, options }) {
    if (!accessToken) throw new PlatformError("Pinterest account has no access token.", { auth: true });
    const image = media.find((m) => m.type === "image");
    if (!image) throw new PlatformError("Pinterest needs an image.");

    const boards = Array.isArray(account.metadata.boards) ? (account.metadata.boards as Board[]) : [];
    const boardId = str(options.boardId) ?? boards[0]?.id;
    if (!boardId) {
      throw new PlatformError("No Pinterest board found. Pass platformSpecificData.boardId or create a board and reconnect.");
    }

    const body: Record<string, unknown> = {
      board_id: boardId,
      description: content.slice(0, 500),
      media_source: { source_type: "image_url", url: image.url },
    };
    const title = str(options.title);
    if (title) body.title = title.slice(0, 100);
    const link = str(options.link);
    if (link) body.link = link;
    if (image.altText) body.alt_text = image.altText.slice(0, 500);

    const pin = await fetchJson<{ id: string }>(`${API}/pins`, {
      method: "POST",
      label: "Pinterest create pin",
      headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!pin?.id) throw new PlatformError("Pinterest did not return a pin id.", { retryable: true });
    return { platformPostId: String(pin.id), url: `https://www.pinterest.com/pin/${pin.id}/` };
  },

  analytics: {
    postBatchSize: 1,
    note: "Pin analytics need a Pinterest business account and cover the last 90 days.",

    async fetchPostMetrics({ accessToken }, ids) {
      if (!accessToken) throw new PlatformError("Pinterest account has no access token.", { auth: true });
      const out: Record<string, PostMetrics> = {};
      for (const id of ids) {
        const params = new URLSearchParams({ ...analyticsWindow(), metric_types: "IMPRESSION,SAVE,PIN_CLICK,OUTBOUND_CLICK" });
        let res: any;
        try {
          res = await fetchJson<any>(`${API}/pins/${encodeURIComponent(id)}/analytics?${params}`, {
            label: "Pinterest pin metrics",
            headers: { Authorization: `Bearer ${accessToken}` },
          });
        } catch (err) {
          if (err instanceof PlatformError && err.opts.status === 404) continue;
          throw err;
        }
        const m = res?.all?.summary_metrics ?? res?.all?.lifetime_metrics ?? {};
        const pinClicks = num(m.PIN_CLICK);
        const outbound = num(m.OUTBOUND_CLICK);
        out[id] = {
          impressions: num(m.IMPRESSION),
          saves: num(m.SAVE),
          clicks: pinClicks === null && outbound === null ? null : (pinClicks ?? 0) + (outbound ?? 0),
        };
      }
      return out;
    },

    async fetchAccountMetrics({ accessToken }): Promise<AccountMetrics> {
      if (!accessToken) throw new PlatformError("Pinterest account has no access token.", { auth: true });
      const user = await fetchJson<any>(`${API}/user_account`, {
        label: "Pinterest account metrics",
        headers: { Authorization: `Bearer ${accessToken}` },
      });
      return { followers: num(user.follower_count), following: num(user.following_count), posts: num(user.pin_count) };
    },
  },
};
