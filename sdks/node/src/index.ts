import { createHmac, timingSafeEqual } from "node:crypto";

export const VERSION = "0.1.0";

/* ------------------------------------------------------------------ */
/* Types                                                               */
/* ------------------------------------------------------------------ */

export type PlatformId =
  | "twitter"
  | "linkedin"
  | "facebook"
  | "instagram"
  | "threads"
  | "tiktok"
  | "youtube"
  | "pinterest"
  | "reddit"
  | "googlebusiness"
  | "bluesky"
  | "mastodon"
  | "telegram"
  | "discord"
  | (string & {});

export type PostStatus = "draft" | "scheduled" | "publishing" | "published" | "partial" | "failed" | "cancelled";
export type TargetStatus = "pending" | "publishing" | "published" | "failed" | "cancelled";
export type AccountStatus = "active" | "expired" | "error";

export type WebhookEventName =
  | "post.published"
  | "post.partial"
  | "post.failed"
  | "account.connected"
  | "account.disconnected"
  | "account.expired";

export interface MediaItem {
  /** Public URL of the image or video. */
  url: string;
  /** Guessed from the file extension when omitted. */
  type?: "image" | "video";
  altText?: string;
}

export interface PlatformTarget {
  accountId: string;
  /** Optional. When set it must match the account's platform. */
  platform?: PlatformId;
  /** Overrides the post text for this account. */
  content?: string;
  /** Network specific options, e.g. `{ title: "..." }` for YouTube. See the API docs. */
  platformSpecificData?: Record<string, unknown>;
}

export interface CreatePostInput {
  content?: string;
  mediaItems?: MediaItem[];
  platforms: PlatformTarget[];
  /** ISO date time. Without an offset it is read in `timezone`. Omit to publish now. */
  scheduledFor?: string | Date;
  /** IANA time zone. Default "UTC". */
  timezone?: string;
  publishNow?: boolean;
  isDraft?: boolean;
  profileId?: string;
  externalId?: string;
}

export interface PostTarget {
  id: string;
  platform: PlatformId;
  accountId: string | null;
  status: TargetStatus;
  platformPostId: string | null;
  platformPostUrl: string | null;
  error: string | null;
  attempts: number;
  publishedAt: string | null;
  /** Latest metrics from the network; null until the first collection. */
  metrics: PostMetrics | null;
  metricsUpdatedAt: string | null;
  content?: string;
  platformSpecificData?: Record<string, unknown>;
}

export interface Post {
  id: string;
  status: PostStatus;
  content: string;
  mediaItems: MediaItem[];
  scheduledFor: string;
  timezone: string;
  profileId: string | null;
  externalId: string | null;
  source: "api" | "dashboard";
  publishedAt: string | null;
  createdAt: string;
  platforms: PostTarget[];
}

export interface ListPostsParams {
  limit?: number;
  cursor?: string;
  status?: PostStatus;
  profileId?: string;
}

export interface PostPage {
  posts: Post[];
  nextCursor: string | null;
}

export interface Account {
  id: string;
  platform: PlatformId;
  profileId: string;
  platformAccountId: string;
  username: string | null;
  displayName: string | null;
  avatarUrl: string | null;
  status: AccountStatus;
  lastError: string | null;
  tokenExpiresAt: string | null;
  /** Latest follower count, when the network reports it. */
  followers: number | null;
  usesOwnApp: boolean;
  metadata: Record<string, unknown>;
  createdAt: string;
}

export interface Profile {
  id: string;
  name: string;
  description: string | null;
  /** Returned by list and get. */
  accountCount?: number;
  createdAt: string;
}

export interface Platform {
  id: PlatformId;
  name: string;
  connectType: "oauth" | "credentials";
  available: boolean;
  usesOwnApp: boolean;
  maxChars: number | null;
  maxImages: number;
  supportsVideo: boolean;
  supportsTextOnly: boolean;
  requiresMedia: boolean;
}

export interface Webhook {
  id: string;
  url: string;
  events: WebhookEventName[];
  active: boolean;
  lastStatus: number | null;
  lastError: string | null;
  lastDelivered: string | null;
  createdAt: string;
}

export interface WebhookWithSecret extends Webhook {
  secret: string;
}

export interface Usage {
  plan: "free" | "starter" | "growth" | "scale" | (string & {});
  accounts: { used: number; limit: number };
  postsThisMonth: { used: number; limit: number | null };
}

export interface ConnectUrl {
  authUrl: string;
  expiresInSeconds: number;
}

/** Unified post metrics. A field is missing (or null) when the network does not report it. */
export interface PostMetrics {
  impressions?: number | null;
  reach?: number | null;
  views?: number | null;
  likes?: number | null;
  comments?: number | null;
  shares?: number | null;
  saves?: number | null;
  clicks?: number | null;
  quotes?: number | null;
}

/**
 * Sums over published targets; a metric is null when no target reported it.
 * engagements = likes + comments + shares + saves + quotes.
 * engagementRate = engagements / (impressions, else views, else reach), as a fraction.
 */
export interface AnalyticsTotals {
  /** Published targets (one per account a post went to). */
  posts: number;
  engagements: number;
  engagementRate: number | null;
  /** Per target impressions, else views, else reach, summed. The denominator of engagementRate. */
  audience: number | null;
  impressions: number | null;
  reach: number | null;
  views: number | null;
  likes: number | null;
  comments: number | null;
  shares: number | null;
  saves: number | null;
  clicks: number | null;
  quotes: number | null;
}

export interface AnalyticsRangeParams {
  /** ISO date (whole day) or date-time. */
  from?: string | Date;
  to?: string | Date;
  /** Range length when `from` is omitted. Default 30. */
  days?: number;
}

export interface AnalyticsOverviewParams extends AnalyticsRangeParams {
  profileId?: string;
  platform?: PlatformId;
  accountId?: string;
  /** IANA time zone for the daily buckets. Default UTC. */
  timezone?: string;
}

export interface AnalyticsOverview {
  range: { from: string; to: string; timezone: string };
  totals: AnalyticsTotals;
  coverage: { posts: number; withMetrics: number };
  byPlatform: (AnalyticsTotals & { platform: PlatformId })[];
  /** One entry per day by publish date. Missing metrics count as 0 here. */
  daily: { date: string; posts: number; engagements: number; impressions: number; views: number }[];
  topPosts: {
    postId: string;
    targetId: string;
    platform: PlatformId;
    accountId: string | null;
    content: string;
    url: string | null;
    publishedAt: string | null;
    metrics: PostMetrics;
    engagements: number;
    engagementRate: number | null;
  }[];
  accounts: {
    accountId: string;
    platform: PlatformId;
    name: string | null;
    followers: number | null;
    followersChange: number | null;
    series: { date: string; followers: number }[];
    metricsError: string | null;
  }[];
}

export interface PostAnalytics {
  postId: string;
  content: string;
  publishedAt: string | null;
  totals: AnalyticsTotals;
  platforms: {
    targetId: string;
    platform: PlatformId;
    accountId: string | null;
    status: TargetStatus;
    url: string | null;
    publishedAt: string | null;
    metrics: PostMetrics | null;
    engagements: number;
    engagementRate: number | null;
    metricsUpdatedAt: string | null;
    /** Null when collection has stopped. */
    nextUpdateAt: string | null;
    metricsError: string | null;
    /** False when the network does not report post metrics. */
    supported: boolean;
    history: (PostMetrics & { capturedAt: string })[];
  }[];
}

export interface AccountAnalytics {
  accountId: string;
  platform: PlatformId;
  name: string | null;
  followers: number | null;
  followersChange: number | null;
  supported: boolean;
  metricsError: string | null;
  series: { date: string; followers: number | null; following: number | null; posts: number | null }[];
}

export type WebhookEvent =
  | { id: string; event: "post.published" | "post.partial" | "post.failed"; createdAt: string; data: Post }
  | { id: string; event: "account.connected" | "account.disconnected" | "account.expired"; createdAt: string; data: Account }
  | { id: string; event: "webhook.test"; createdAt: string; data: { message: string } };

export interface FanoutOptions {
  apiKey: string;
  /** Your API host, e.g. "https://api.yourdomain.com". "/api/v1" is added if missing. */
  baseUrl?: string;
  /** Retries for GET requests on network errors, 429 and 5xx. Default 2. */
  maxRetries?: number;
  /** Per request timeout. Default 60000 ms. */
  timeoutMs?: number;
  /** Custom fetch implementation (for tests or old runtimes). */
  fetch?: typeof fetch;
}

/* ------------------------------------------------------------------ */
/* Errors                                                              */
/* ------------------------------------------------------------------ */

export class FanoutError extends Error {
  /** HTTP status, or 0 for network errors and timeouts. */
  readonly status: number;
  /** Machine readable code, e.g. "validation_error", "plan_limit", "not_found". */
  readonly code: string;
  /** Extra data. For 422 responses: `[{ accountId, platform, errors: string[] }]`. */
  readonly details: unknown;

  constructor(message: string, init: { status: number; code: string; details?: unknown }) {
    super(message);
    this.name = "FanoutError";
    this.status = init.status;
    this.code = init.code;
    this.details = init.details;
  }
}

/* ------------------------------------------------------------------ */
/* Client                                                              */
/* ------------------------------------------------------------------ */

type Query = Record<string, string | number | undefined | null>;

interface RequestOptions {
  query?: Query;
  body?: unknown;
  headers?: Record<string, string>;
  /** Allow retries for a non-GET request (safe when it carries an Idempotency-Key). */
  retry?: boolean;
}

export interface CreatePostOptions {
  /** Unique key per logical post. Retries with the same key never create a duplicate. */
  idempotencyKey?: string;
}

const DEFAULT_BASE_URL = "https://api.example.com";

function envBaseUrl(): string | undefined {
  const proc = (globalThis as { process?: { env?: Record<string, string | undefined> } }).process;
  return proc?.env?.FANOUT_BASE_URL;
}

function normalizeBaseUrl(raw: string): string {
  const trimmed = raw.replace(/\/+$/, "");
  return trimmed.endsWith("/api/v1") ? trimmed : `${trimmed}/api/v1`;
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const enc = encodeURIComponent;

export interface PostsResource {
  /** Create or schedule a post. Returns the post with one target per account. */
  create(input: CreatePostInput, options?: CreatePostOptions): Promise<Post>;
  /** One page of posts, newest first. */
  list(params?: ListPostsParams): Promise<PostPage>;
  /** Iterate over every post, fetching pages as needed. */
  iterate(params?: ListPostsParams): AsyncGenerator<Post>;
  get(id: string): Promise<Post>;
  /** Cancel a scheduled post, or delete a finished one from history. It is never deleted from the network. */
  delete(id: string): Promise<{ deleted: boolean; cancelled: boolean }>;
  /** Alias of delete. */
  cancel(id: string): Promise<{ deleted: boolean; cancelled: boolean }>;
  /** Queue failed targets again. */
  retry(id: string): Promise<{ requeued: number }>;
}

export interface AccountsResource {
  list(params?: { profileId?: string; platform?: PlatformId }): Promise<Account[]>;
  get(id: string): Promise<Account>;
  /** Disconnect the account and delete its tokens. */
  disconnect(id: string): Promise<{ deleted: true }>;
}

export interface ProfilesResource {
  list(): Promise<Profile[]>;
  create(input: { name: string; description?: string }): Promise<Profile>;
  get(id: string): Promise<Profile>;
  update(id: string, input: { name?: string; description?: string | null }): Promise<Profile>;
  /** Deleting a profile also removes its accounts. */
  delete(id: string): Promise<{ deleted: true }>;
}

export interface ConnectResource {
  /** A one-time hosted link (valid 30 minutes) that connects an account. */
  getUrl(platform: PlatformId, params?: { profileId?: string; redirectUrl?: string }): Promise<ConnectUrl>;
}

export interface WebhooksResource {
  list(): Promise<Webhook[]>;
  /** The returned secret is only shown once. Empty `events` means all events. */
  create(input: { url: string; events?: WebhookEventName[] }): Promise<WebhookWithSecret>;
  delete(id: string): Promise<{ deleted: true }>;
  test(id: string): Promise<{ delivered: boolean; status: number | null; error: string | null }>;
}

export interface AnalyticsResource {
  /** Totals, per-network breakdown, daily series, top posts and follower growth. */
  overview(params?: AnalyticsOverviewParams): Promise<AnalyticsOverview>;
  /** Latest metrics and history of one post, per account. */
  post(id: string): Promise<PostAnalytics>;
  /** Ask for fresh metrics now. Targets updated in the last 5 minutes are skipped, so `queued` can be 0. */
  refreshPost(id: string): Promise<{ queued: number }>;
  /** Daily follower history of one account. */
  account(id: string, params?: AnalyticsRangeParams): Promise<AccountAnalytics>;
}

export class Fanout {
  readonly baseUrl: string;
  readonly posts: PostsResource;
  readonly accounts: AccountsResource;
  readonly profiles: ProfilesResource;
  readonly connect: ConnectResource;
  readonly platforms: { list(): Promise<Platform[]> };
  readonly webhooks: WebhooksResource;
  readonly usage: { get(): Promise<Usage> };
  readonly analytics: AnalyticsResource;

  private readonly apiKey: string;
  private readonly maxRetries: number;
  private readonly timeoutMs: number;
  private readonly fetchImpl: typeof fetch;

  constructor(options: FanoutOptions) {
    if (!options || !options.apiKey) throw new Error("Fanout: apiKey is required");
    this.apiKey = options.apiKey;
    this.baseUrl = normalizeBaseUrl(options.baseUrl ?? envBaseUrl() ?? DEFAULT_BASE_URL);
    this.maxRetries = options.maxRetries ?? 2;
    this.timeoutMs = options.timeoutMs ?? 60_000;
    const f = options.fetch ?? globalThis.fetch;
    if (!f) throw new Error("Fanout: no fetch implementation found. Use Node 18+ or pass options.fetch.");
    this.fetchImpl = f.bind(globalThis);

    const req = <T>(method: string, path: string, opts?: RequestOptions) => this.request<T>(method, path, opts);

    const listPosts = (params: ListPostsParams = {}) => req<PostPage>("GET", "/posts", { query: { ...params } });
    const deletePost = (id: string) => req<{ deleted: boolean; cancelled: boolean }>("DELETE", `/posts/${enc(id)}`);
    this.posts = {
      create: async (input, options = {}) => {
        const body = {
          ...input,
          scheduledFor: input.scheduledFor instanceof Date ? input.scheduledFor.toISOString() : input.scheduledFor,
        };
        const key = options.idempotencyKey;
        return (await req<{ post: Post }>("POST", "/posts", { body, ...(key ? { headers: { "Idempotency-Key": key }, retry: true } : {}) })).post;
      },
      list: listPosts,
      iterate: async function* (params: ListPostsParams = {}) {
        let cursor = params.cursor;
        for (;;) {
          const page = await listPosts({ ...params, cursor });
          for (const post of page.posts) yield post;
          if (!page.nextCursor) return;
          cursor = page.nextCursor;
        }
      },
      get: async (id) => (await req<{ post: Post }>("GET", `/posts/${enc(id)}`)).post,
      delete: deletePost,
      cancel: deletePost,
      retry: (id) => req<{ requeued: number }>("POST", `/posts/${enc(id)}/retry`),
    };

    this.accounts = {
      list: async (params = {}) => (await req<{ accounts: Account[] }>("GET", "/accounts", { query: { ...params } })).accounts,
      get: async (id) => (await req<{ account: Account }>("GET", `/accounts/${enc(id)}`)).account,
      disconnect: (id) => req<{ deleted: true }>("DELETE", `/accounts/${enc(id)}`),
    };

    this.profiles = {
      list: async () => (await req<{ profiles: Profile[] }>("GET", "/profiles")).profiles,
      create: async (input) => (await req<{ profile: Profile }>("POST", "/profiles", { body: input })).profile,
      get: async (id) => (await req<{ profile: Profile }>("GET", `/profiles/${enc(id)}`)).profile,
      update: async (id, input) => (await req<{ profile: Profile }>("PATCH", `/profiles/${enc(id)}`, { body: input })).profile,
      delete: (id) => req<{ deleted: true }>("DELETE", `/profiles/${enc(id)}`),
    };

    this.connect = {
      getUrl: (platform, params = {}) => req<ConnectUrl>("GET", `/connect/${enc(platform)}`, { query: { ...params } }),
    };

    this.platforms = {
      list: async () => (await req<{ platforms: Platform[] }>("GET", "/platforms")).platforms,
    };

    this.webhooks = {
      list: async () => (await req<{ webhooks: Webhook[] }>("GET", "/webhooks")).webhooks,
      create: async (input) => (await req<{ webhook: WebhookWithSecret }>("POST", "/webhooks", { body: input })).webhook,
      delete: (id) => req<{ deleted: true }>("DELETE", `/webhooks/${enc(id)}`),
      test: (id) => req<{ delivered: boolean; status: number | null; error: string | null }>("POST", `/webhooks/${enc(id)}/test`),
    };

    this.usage = { get: () => req<Usage>("GET", "/usage") };

    const range = (params: AnalyticsRangeParams & Record<string, unknown>): Query => {
      const q: Query = {};
      for (const [key, value] of Object.entries(params)) {
        if (value instanceof Date) q[key] = value.toISOString();
        else if (typeof value === "string" || typeof value === "number") q[key] = value;
      }
      return q;
    };
    this.analytics = {
      overview: (params = {}) => req<AnalyticsOverview>("GET", "/analytics", { query: range({ ...params }) }),
      post: (id) => req<PostAnalytics>("GET", `/analytics/posts/${enc(id)}`),
      refreshPost: (id) => req<{ queued: number }>("POST", `/analytics/posts/${enc(id)}/refresh`),
      account: (id, params = {}) => req<AccountAnalytics>("GET", `/analytics/accounts/${enc(id)}`, { query: range({ ...params }) }),
    };
  }

  private async request<T>(method: string, path: string, opts: RequestOptions = {}): Promise<T> {
    const url = new URL(this.baseUrl + path);
    for (const [key, value] of Object.entries(opts.query ?? {})) {
      if (value !== undefined && value !== null && value !== "") url.searchParams.set(key, String(value));
    }
    const headers: Record<string, string> = {
      Authorization: `Bearer ${this.apiKey}`,
      Accept: "application/json",
      "User-Agent": `fanout-node/${VERSION}`,
    };
    if (opts.body !== undefined) headers["Content-Type"] = "application/json";
    Object.assign(headers, opts.headers);

    const retries = method === "GET" || opts.retry ? this.maxRetries : 0;
    for (let attempt = 0; ; attempt++) {
      let res: Response;
      try {
        res = await this.fetchImpl(url, {
          method,
          headers,
          body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
          signal: AbortSignal.timeout(this.timeoutMs),
        });
      } catch (err) {
        if (attempt < retries) {
          await sleep(backoff(attempt));
          continue;
        }
        throw new FanoutError(`Request failed: ${(err as Error).message}`, { status: 0, code: "network_error" });
      }

      if ((res.status === 429 || res.status >= 500) && attempt < retries) {
        await sleep(retryAfterMs(res.headers.get("retry-after")) ?? backoff(attempt));
        continue;
      }

      const text = await res.text();
      let data: unknown = undefined;
      if (text) {
        try {
          data = JSON.parse(text);
        } catch {
          data = text;
        }
      }
      if (!res.ok) {
        const err = (data as { error?: { code?: string; message?: string; details?: unknown } } | undefined)?.error;
        throw new FanoutError(err?.message ?? `HTTP ${res.status}`, {
          status: res.status,
          code: err?.code ?? "http_error",
          details: err?.details,
        });
      }
      return data as T;
    }
  }
}

function backoff(attempt: number): number {
  return 500 * 2 ** attempt;
}

function retryAfterMs(header: string | null): number | undefined {
  if (!header) return undefined;
  const seconds = Number(header);
  if (Number.isFinite(seconds)) return Math.min(seconds, 30) * 1000;
  const date = Date.parse(header);
  return Number.isNaN(date) ? undefined : Math.min(Math.max(date - Date.now(), 0), 30_000);
}

/* ------------------------------------------------------------------ */
/* Webhooks                                                            */
/* ------------------------------------------------------------------ */

export const WEBHOOK_SIGNATURE_HEADER = "X-Fanout-Signature";

/**
 * Check the `X-Fanout-Signature` header of a webhook delivery.
 * Pass the raw request body exactly as received (not re-serialized JSON).
 */
export function verifyWebhookSignature(
  rawBody: string | Uint8Array,
  header: string | null | undefined,
  secret: string,
  toleranceSec = 300,
  nowSec: number = Math.floor(Date.now() / 1000),
): boolean {
  if (!header || !secret) return false;
  let timestamp: number | undefined;
  const signatures: string[] = [];
  for (const part of header.split(",")) {
    const index = part.indexOf("=");
    if (index < 0) continue;
    const key = part.slice(0, index).trim();
    const value = part.slice(index + 1).trim();
    if (key === "t") timestamp = Number(value);
    else if (key === "v1") signatures.push(value);
  }
  if (timestamp === undefined || !Number.isFinite(timestamp) || signatures.length === 0) return false;
  if (toleranceSec > 0 && Math.abs(nowSec - timestamp) > toleranceSec) return false;

  const body = typeof rawBody === "string" ? rawBody : Buffer.from(rawBody).toString("utf8");
  const expected = Buffer.from(createHmac("sha256", secret).update(`${timestamp}.${body}`).digest("hex"));
  return signatures.some((sig) => {
    const given = Buffer.from(sig);
    return given.length === expected.length && timingSafeEqual(given, expected);
  });
}

/** Verify the signature and parse the event. Throws FanoutError (code "invalid_signature") if the check fails. */
export function constructWebhookEvent(
  rawBody: string | Uint8Array,
  header: string | null | undefined,
  secret: string,
  toleranceSec = 300,
): WebhookEvent {
  if (!verifyWebhookSignature(rawBody, header, secret, toleranceSec)) {
    throw new FanoutError("Invalid webhook signature.", { status: 400, code: "invalid_signature" });
  }
  const body = typeof rawBody === "string" ? rawBody : Buffer.from(rawBody).toString("utf8");
  return JSON.parse(body) as WebhookEvent;
}

export default Fanout;
