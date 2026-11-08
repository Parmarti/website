import type { ConnectedAccount, OAuthAdapter, TokenSet } from "./types";
import { PlatformError, expiresIn, fetchJson, form, str } from "./http";

const SCOPES = ["https://www.googleapis.com/auth/business.manage"];
const TOKEN_URL = "https://oauth2.googleapis.com/token";
const ACCOUNTS_API = "https://mybusinessaccountmanagement.googleapis.com/v1";
const INFO_API = "https://mybusinessbusinessinformation.googleapis.com/v1";
const POSTS_API = "https://mybusiness.googleapis.com/v4";
const TOPICS = ["STANDARD", "EVENT", "OFFER"];
const CTA_TYPES = ["BOOK", "ORDER", "SHOP", "LEARN_MORE", "SIGN_UP", "CALL"];
const MAX_CHARS = 1500;

interface GoogleToken {
  access_token: string;
  refresh_token?: string;
  expires_in?: number;
}

/** "2026-12-01T18:30" (local time of the business) -> Google Date and TimeOfDay objects. */
function googleDateTime(value: string) {
  const m = /^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2}))?/.exec(value.trim());
  if (!m) throw new PlatformError(`Invalid date '${value}'. Use YYYY-MM-DD or YYYY-MM-DDTHH:mm in the business's local time.`);
  return {
    date: { year: Number(m[1]), month: Number(m[2]), day: Number(m[3]) },
    time: { hours: Number(m[4] ?? 0), minutes: Number(m[5] ?? 0), seconds: 0, nanos: 0 },
  };
}

function wrapGoogleError(err: unknown): never {
  if (err instanceof PlatformError) {
    const g = (err.opts.body as any)?.error;
    if (g?.status === "PERMISSION_DENIED" && /has not been used|is disabled|quota/i.test(String(g.message))) {
      throw new PlatformError(
        `Google Business Profile API access is not enabled for this Google Cloud project. Request access from Google, then enable the APIs. (${g.message})`,
        err.opts,
      );
    }
  }
  throw err;
}

export const googleBusinessAdapter: OAuthAdapter = {
  id: "googlebusiness",
  name: "Google Business",
  kind: "oauth",
  maxChars: MAX_CHARS,
  maxImages: 1,
  supportsVideo: false,
  supportsText: true,
  setupNote:
    "Needs a Google Cloud project with the Business Profile APIs enabled. Google must approve API access first (request form in the Business Profile API docs); until then the quota is zero. One connection can return many locations; the user picks which ones to add.",

  validate({ content, media, options }) {
    const problems: string[] = [];
    if (content.length > MAX_CHARS) problems.push(`Google Business posts are limited to ${MAX_CHARS} characters.`);
    if (media.length > 1) problems.push("Google Business posts can have one image.");
    if (media.some((m) => m.type === "video")) problems.push("Google Business video posts are not supported.");
    if (/\+?\d[\d\s().-]{7,}\d/.test(content)) problems.push("Google rejects posts that contain phone numbers. Use a CALL button instead.");
    const topic = str(options.topicType)?.toUpperCase();
    if (topic && !TOPICS.includes(topic)) problems.push(`topicType must be one of ${TOPICS.join(", ")}.`);
    if ((topic === "EVENT" || topic === "OFFER") && (!str(options.eventTitle) || !str(options.eventStart) || !str(options.eventEnd))) {
      problems.push("EVENT and OFFER posts need eventTitle, eventStart and eventEnd.");
    }
    const cta = str(options.callToActionType)?.toUpperCase();
    if (cta && !CTA_TYPES.includes(cta)) problems.push(`callToActionType must be one of ${CTA_TYPES.join(", ")}.`);
    if (cta && cta !== "CALL" && !str(options.callToActionUrl)) problems.push("callToActionUrl is required for this button type.");
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
      state,
    });
    return `https://accounts.google.com/o/oauth2/v2/auth?${params}`;
  },

  async exchangeCode({ app, code, redirectUri }) {
    const token = await fetchJson<GoogleToken>(TOKEN_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: form({ code, client_id: app.clientId, client_secret: app.clientSecret, redirect_uri: redirectUri, grant_type: "authorization_code" }),
      label: "Google token exchange",
    });
    const auth = { Authorization: `Bearer ${token.access_token}` };
    const tokenSet: TokenSet = {
      accessToken: token.access_token,
      refreshToken: token.refresh_token ?? null,
      expiresAt: expiresIn(token.expires_in),
    };

    let accounts: { name: string; accountName?: string }[] = [];
    try {
      accounts = (await fetchJson<{ accounts?: any[] }>(`${ACCOUNTS_API}/accounts?pageSize=20`, { headers: auth, label: "Google Business accounts" }))
        .accounts ?? [];
    } catch (err) {
      wrapGoogleError(err);
    }

    const result: ConnectedAccount[] = [];
    for (const account of accounts) {
      let pageToken: string | undefined;
      do {
        const params = new URLSearchParams({ readMask: "name,title,storefrontAddress,metadata", pageSize: "100" });
        if (pageToken) params.set("pageToken", pageToken);
        let page: { locations?: any[]; nextPageToken?: string };
        try {
          page = await fetchJson(`${INFO_API}/${account.name}/locations?${params}`, { headers: auth, label: "Google Business locations" });
        } catch (err) {
          wrapGoogleError(err);
        }
        for (const loc of page.locations ?? []) {
          const address = loc.storefrontAddress;
          const city = address ? [address.locality, address.administrativeArea].filter(Boolean).join(", ") : "";
          result.push({
            platformAccountId: String(loc.name).replace(/^locations\//, ""),
            username: city || null,
            displayName: loc.title ?? loc.name,
            avatarUrl: null,
            metadata: { accountName: account.name, locationName: loc.name, mapsUri: loc.metadata?.mapsUri ?? null },
            token: tokenSet,
          });
        }
        pageToken = page.nextPageToken;
      } while (pageToken);
    }
    if (result.length === 0) throw new PlatformError("No Google Business locations were found for this Google account.");
    return result;
  },

  async refresh({ app, refreshToken }) {
    if (!refreshToken) throw new PlatformError("Google Business account has no refresh token. Reconnect it.", { auth: true });
    try {
      const token = await fetchJson<GoogleToken>(TOKEN_URL, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: form({ client_id: app.clientId, client_secret: app.clientSecret, refresh_token: refreshToken, grant_type: "refresh_token" }),
        label: "Google token refresh",
      });
      return { accessToken: token.access_token, refreshToken: token.refresh_token ?? refreshToken, expiresAt: expiresIn(token.expires_in) };
    } catch (err) {
      if (err instanceof PlatformError && err.opts.status === 400) {
        throw new PlatformError(`Google refresh token was rejected. Reconnect the account. ${err.message}`, { auth: true });
      }
      throw err;
    }
  },

  async publish(ctx) {
    if (!ctx.accessToken) throw new PlatformError("Google Business account has no access token.", { auth: true });
    const accountName = ctx.account.metadata.accountName as string | undefined;
    if (!accountName) throw new PlatformError("Missing Google Business account reference. Reconnect the location.", { auth: true });
    const parent = `${accountName}/locations/${ctx.account.platformAccountId}`;
    const o = ctx.options;
    const topic = str(o.topicType)?.toUpperCase() ?? "STANDARD";

    const body: Record<string, unknown> = {
      languageCode: str(o.languageCode) ?? "en",
      summary: ctx.content,
      topicType: topic,
    };
    const image = ctx.media.find((m) => m.type === "image");
    if (image) body.media = [{ mediaFormat: "PHOTO", sourceUrl: image.url }];
    const cta = str(o.callToActionType)?.toUpperCase();
    if (cta) body.callToAction = cta === "CALL" ? { actionType: "CALL" } : { actionType: cta, url: str(o.callToActionUrl) };
    if (topic === "EVENT" || topic === "OFFER") {
      const start = googleDateTime(String(o.eventStart));
      const end = googleDateTime(String(o.eventEnd));
      body.event = {
        title: str(o.eventTitle),
        schedule: { startDate: start.date, startTime: start.time, endDate: end.date, endTime: end.time },
      };
    }
    if (topic === "OFFER") {
      body.offer = { couponCode: str(o.couponCode), redeemOnlineUrl: str(o.redeemUrl), termsConditions: str(o.terms) };
    }

    let post: { name: string; searchUrl?: string };
    try {
      post = await fetchJson(`${POSTS_API}/${parent}/localPosts`, {
        method: "POST",
        headers: { Authorization: `Bearer ${ctx.accessToken}`, "Content-Type": "application/json" },
        body: JSON.stringify(body),
        label: "Google Business post",
      });
    } catch (err) {
      wrapGoogleError(err);
    }
    return { platformPostId: post.name, url: post.searchUrl ?? (ctx.account.metadata.mapsUri as string | null) ?? null };
  },
  analytics: {
    note: "Google no longer reports metrics for Business Profile posts.",
  },
};
