export const PLATFORM_IDS = [
  "twitter",
  "linkedin",
  "facebook",
  "instagram",
  "threads",
  "tiktok",
  "youtube",
  "pinterest",
  "reddit",
  "googlebusiness",
  "bluesky",
  "mastodon",
  "telegram",
  "discord",
] as const;

export type PlatformId = (typeof PLATFORM_IDS)[number];

export function isPlatformId(value: string): value is PlatformId {
  return (PLATFORM_IDS as readonly string[]).includes(value);
}

export interface MediaItem {
  type: "image" | "video";
  url: string;
  altText?: string;
}

export interface AppCredentials {
  clientId: string;
  clientSecret: string;
}

export interface TokenSet {
  accessToken: string;
  refreshToken?: string | null;
  expiresAt?: Date | null;
}

export interface ConnectedIdentity {
  platformAccountId: string;
  username?: string | null;
  displayName?: string | null;
  avatarUrl?: string | null;
  metadata?: Record<string, unknown>;
}

/** One OAuth grant can yield several publishable accounts (e.g. Facebook Pages). */
export interface ConnectedAccount extends ConnectedIdentity {
  token: TokenSet;
}

export interface PublishContext {
  account: {
    id: string;
    platformAccountId: string;
    username: string | null;
    metadata: Record<string, unknown>;
  };
  accessToken: string | null;
  credentials: Record<string, string> | null;
  app: AppCredentials | null;
  content: string;
  media: MediaItem[];
  options: Record<string, unknown>;
}

/** Unified post metrics. A field is null or missing when the network does not report it. */
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

export interface AccountMetrics {
  followers?: number | null;
  following?: number | null;
  posts?: number | null;
}

export interface AnalyticsSupport {
  /** How many post ids one fetchPostMetrics call accepts (default 1). */
  postBatchSize?: number;
  /** Return metrics keyed by platformPostId. Ids missing from the result are treated as not found. */
  fetchPostMetrics?(ctx: PublishContext, platformPostIds: string[]): Promise<Record<string, PostMetrics>>;
  fetchAccountMetrics?(ctx: PublishContext): Promise<AccountMetrics>;
  /** Plain words shown in the dashboard, e.g. which permission is needed. */
  note?: string;
}

export interface PublishResult {
  platformPostId: string;
  url?: string | null;
}

interface AdapterBase {
  id: PlatformId;
  name: string;
  /** Max characters for the post text, used for validation. */
  maxChars?: number;
  maxImages: number;
  supportsVideo: boolean;
  supportsText: boolean;
  /** Platform needs media (no text only posts). */
  requiresMedia?: boolean;
  /** Short note shown in the dashboard about platform approval requirements. */
  setupNote?: string;
  /** Platform-specific validation. Return a list of human readable problems. */
  validate?(input: { content: string; media: MediaItem[]; options: Record<string, unknown> }): string[];
  publish(ctx: PublishContext): Promise<PublishResult>;
  analytics?: AnalyticsSupport;
}

export interface OAuthAdapter extends AdapterBase {
  kind: "oauth";
  usesPkce?: boolean;
  getAuthUrl(input: { app: AppCredentials; redirectUri: string; state: string; codeChallenge?: string }): string;
  exchangeCode(input: { app: AppCredentials; code: string; redirectUri: string; codeVerifier?: string }): Promise<ConnectedAccount[]>;
  refresh?(input: { app: AppCredentials; refreshToken: string | null; accessToken: string }): Promise<TokenSet>;
}

export interface CredentialField {
  name: string;
  label: string;
  type: "text" | "password" | "url";
  placeholder?: string;
  help?: string;
  optional?: boolean;
}

export interface CredentialAdapter extends AdapterBase {
  kind: "credentials";
  fields: CredentialField[];
  helpText: string;
  verify(fields: Record<string, string>): Promise<{ identity: ConnectedIdentity; credentials: Record<string, string> }>;
}

export type PlatformAdapter = OAuthAdapter | CredentialAdapter;
