import { brand } from "./brand";
import { PLATFORM_IDS } from "./platforms/types";

const WEBHOOK_EVENT_NAMES = [
  "post.published",
  "post.partial",
  "post.failed",
  "account.connected",
  "account.disconnected",
  "account.expired",
];

const ref = (name: string) => ({ $ref: `#/components/schemas/${name}` });

const jsonBody = (schema: unknown, description?: string) => ({
  ...(description ? { description } : {}),
  required: true,
  content: { "application/json": { schema } },
});

const jsonResponse = (description: string, schema: unknown) => ({
  description,
  content: { "application/json": { schema } },
});

const errorResponse = (description: string) => jsonResponse(description, ref("Error"));

const idParam = (description: string) => ({
  name: "id",
  in: "path",
  required: true,
  description,
  schema: { type: "string" },
});

const commonErrors = {
  "401": errorResponse("Missing or invalid API key (`unauthorized`)."),
  "500": errorResponse("Unexpected server error (`internal_error`)."),
};

const notFound = { "404": errorResponse("Not found, or it belongs to another user (`not_found`).") };

const queryParam = (name: string, description: string, schema: Record<string, unknown> = { type: "string" }) => ({
  name,
  in: "query",
  required: false,
  description,
  schema,
});

const rangeParams = [
  queryParam("from", "Start of the range: ISO date (`2026-10-01`) or date-time. Default: `days` before `to`."),
  queryParam("to", "End of the range: ISO date (whole day included) or date-time. Default: now."),
  queryParam("days", "Range length in days when `from` is omitted. Default 30. Ranges are capped at 366 days.", { type: "integer", minimum: 1 }),
];

const ENGAGEMENT_NOTE =
  "engagements = likes + comments + shares + saves + quotes (clicks and views are not engagements). engagementRate = engagements / audience, where audience is impressions, else views, else reach; null when no audience number is reported.";

const metricNumber = (description: string) => ({ type: ["number", "null"], description });

const platformOptionsDescription = [
  "Platform-specific options. Free-form object; keys depend on the target platform:",
  "- twitter: threadItems (string[]), replyToId (string), allowLongPost (boolean)",
  "- linkedin: link, linkTitle, linkDescription, title (video), visibility (PUBLIC | CONNECTIONS), organizationUrn",
  "- facebook: link, title (video), firstComment",
  "- instagram: contentType (\"story\"), shareToFeed (boolean), coverUrl, thumbOffset (ms), firstComment",
  "- threads: link, replyChain (string[])",
  "- tiktok: privacyLevel (PUBLIC_TO_EVERYONE | MUTUAL_FOLLOW_FRIENDS | FOLLOWER_OF_CREATOR | SELF_ONLY), disableComment, disableDuet, disableStitch, videoCoverTimestampMs",
  "- youtube: title, visibility (public | unlisted | private), tags (string[]), categoryId, madeForKids (boolean)",
  "- pinterest: boardId, title, link",
  "- reddit: subreddit (required), title (required), url",
  "- googlebusiness: topicType (STANDARD | EVENT | OFFER), callToActionType (BOOK | ORDER | SHOP | LEARN_MORE | SIGN_UP | CALL), callToActionUrl, eventTitle, eventStart, eventEnd (YYYY-MM-DDTHH:mm local time), couponCode, redeemUrl, terms, languageCode",
  "- bluesky: replyToUri (at:// URI), langs (string[])",
  "- mastodon: visibility (public | unlisted | private | direct), spoilerText, sensitive (boolean), language",
  "- telegram: parseMode (HTML | MarkdownV2), disableLinkPreview (boolean), disableNotification (boolean)",
  "- discord: username, avatarUrl, allowMentions (boolean)",
].join("\n");

/** OpenAPI 3.1 description of the public REST API. */
export function openApiDocument(baseUrl: string) {
  const base = baseUrl.replace(/\/$/, "");
  return {
    openapi: "3.1.0",
    info: {
      title: `${brand.name} API`,
      version: "1.0.0",
      description: `${brand.description}\n\nAuthenticate with \`Authorization: Bearer <API key>\`. Errors use HTTP status codes and the body \`{ "error": { "code", "message", "details" } }\`.`,
      contact: { email: brand.supportEmail },
    },
    servers: [{ url: `${base}/api/v1` }],
    security: [{ bearerAuth: [] }],
    tags: [
      { name: "Posts", description: "Create, schedule and track posts." },
      { name: "Accounts", description: "Connected social accounts." },
      { name: "Profiles", description: "Groups of accounts, one per customer or brand." },
      { name: "Connect", description: "Hosted links that connect a social account." },
      { name: "Platforms", description: "Supported networks and their limits." },
      { name: "Webhooks", description: "Signed event notifications." },
      { name: "Usage", description: "Plan limits and usage." },
      { name: "Analytics", description: "Post metrics and follower growth, collected from each network on a schedule." },
    ],
    paths: {
      "/posts": {
        post: {
          operationId: "createPost",
          tags: ["Posts"],
          summary: "Create or schedule a post",
          description:
            "Creates a post for one or more accounts. Publishing happens in the background; use webhooks or GET /posts/{id} to see the result. Omit scheduledFor (or set publishNow) to publish immediately.",
          parameters: [
            {
              name: "Idempotency-Key",
              in: "header",
              required: false,
              description: "Unique string (max 255). Repeating a request with the same key returns the first post (200, Idempotent-Replayed: true) instead of creating a duplicate.",
              schema: { type: "string", maxLength: 255 },
            },
          ],
          requestBody: jsonBody(ref("CreatePostRequest")),
          responses: {
            "201": jsonResponse("Post created.", { type: "object", required: ["post"], properties: { post: ref("Post") } }),
            "400": errorResponse("Invalid JSON, fields or time zone (`invalid_json`, `validation_error`)."),
            "402": errorResponse("Plan limit reached (`plan_limit`)."),
            "422": errorResponse("A network cannot accept the post (`platform_rejected`). `details` is an array of `{ accountId, platform, errors[] }`."),
            ...commonErrors,
          },
        },
        get: {
          operationId: "listPosts",
          tags: ["Posts"],
          summary: "List posts",
          description: "Newest first. Use `nextCursor` as `cursor` to get the next page.",
          parameters: [
            { name: "limit", in: "query", schema: { type: "integer", minimum: 1, maximum: 100, default: 20 } },
            { name: "cursor", in: "query", schema: { type: "string" } },
            { name: "status", in: "query", schema: ref("PostStatus") },
            { name: "profileId", in: "query", schema: { type: "string" } },
          ],
          responses: {
            "200": jsonResponse("A page of posts.", {
              type: "object",
              required: ["posts", "nextCursor"],
              properties: { posts: { type: "array", items: ref("Post") }, nextCursor: { type: ["string", "null"] } },
            }),
            ...commonErrors,
          },
        },
      },
      "/posts/{id}": {
        get: {
          operationId: "getPost",
          tags: ["Posts"],
          summary: "Get a post",
          parameters: [idParam("Post ID.")],
          responses: {
            "200": jsonResponse("The post with per-platform results.", { type: "object", required: ["post"], properties: { post: ref("Post") } }),
            ...notFound,
            ...commonErrors,
          },
        },
        delete: {
          operationId: "deletePost",
          tags: ["Posts"],
          summary: "Cancel or delete a post",
          description:
            "Cancels a draft, scheduled or publishing post (pending targets are cancelled). A finished post (published, partial, failed or cancelled) is deleted from history. It is never deleted from the social network.",
          parameters: [idParam("Post ID.")],
          responses: {
            "200": jsonResponse("Result.", {
              type: "object",
              required: ["deleted", "cancelled"],
              properties: { deleted: { type: "boolean" }, cancelled: { type: "boolean" } },
            }),
            ...notFound,
            ...commonErrors,
          },
        },
      },
      "/posts/{id}/retry": {
        post: {
          operationId: "retryPost",
          tags: ["Posts"],
          summary: "Retry failed targets",
          description: "Queues every failed target of the post again and publishes it now.",
          parameters: [idParam("Post ID.")],
          responses: {
            "200": jsonResponse("Number of targets queued again.", {
              type: "object",
              required: ["requeued"],
              properties: { requeued: { type: "integer" } },
            }),
            ...notFound,
            ...commonErrors,
          },
        },
      },
      "/accounts": {
        get: {
          operationId: "listAccounts",
          tags: ["Accounts"],
          summary: "List connected accounts",
          parameters: [
            { name: "profileId", in: "query", schema: { type: "string" } },
            { name: "platform", in: "query", schema: ref("PlatformId") },
          ],
          responses: {
            "200": jsonResponse("Accounts.", {
              type: "object",
              required: ["accounts"],
              properties: { accounts: { type: "array", items: ref("Account") } },
            }),
            ...commonErrors,
          },
        },
      },
      "/accounts/{id}": {
        get: {
          operationId: "getAccount",
          tags: ["Accounts"],
          summary: "Get an account",
          parameters: [idParam("Account ID.")],
          responses: {
            "200": jsonResponse("The account.", { type: "object", required: ["account"], properties: { account: ref("Account") } }),
            ...notFound,
            ...commonErrors,
          },
        },
        delete: {
          operationId: "deleteAccount",
          tags: ["Accounts"],
          summary: "Disconnect an account",
          description: "Removes the account and deletes its tokens.",
          parameters: [idParam("Account ID.")],
          responses: {
            "200": jsonResponse("Deleted.", ref("Deleted")),
            ...notFound,
            ...commonErrors,
          },
        },
      },
      "/profiles": {
        get: {
          operationId: "listProfiles",
          tags: ["Profiles"],
          summary: "List profiles",
          responses: {
            "200": jsonResponse("Profiles.", {
              type: "object",
              required: ["profiles"],
              properties: { profiles: { type: "array", items: ref("Profile") } },
            }),
            ...commonErrors,
          },
        },
        post: {
          operationId: "createProfile",
          tags: ["Profiles"],
          summary: "Create a profile",
          requestBody: jsonBody({
            type: "object",
            required: ["name"],
            properties: {
              name: { type: "string", minLength: 1, maxLength: 100 },
              description: { type: "string", maxLength: 500 },
            },
          }),
          responses: {
            "201": jsonResponse("Created.", { type: "object", required: ["profile"], properties: { profile: ref("Profile") } }),
            "400": errorResponse("Invalid fields (`validation_error`)."),
            ...commonErrors,
          },
        },
      },
      "/profiles/{id}": {
        get: {
          operationId: "getProfile",
          tags: ["Profiles"],
          summary: "Get a profile",
          parameters: [idParam("Profile ID.")],
          responses: {
            "200": jsonResponse("The profile.", { type: "object", required: ["profile"], properties: { profile: ref("Profile") } }),
            ...notFound,
            ...commonErrors,
          },
        },
        patch: {
          operationId: "updateProfile",
          tags: ["Profiles"],
          summary: "Rename or describe a profile",
          parameters: [idParam("Profile ID.")],
          requestBody: jsonBody({
            type: "object",
            properties: {
              name: { type: "string", minLength: 1, maxLength: 100 },
              description: { type: ["string", "null"], maxLength: 500 },
            },
          }),
          responses: {
            "200": jsonResponse("Updated.", { type: "object", required: ["profile"], properties: { profile: ref("Profile") } }),
            "400": errorResponse("Invalid fields (`validation_error`)."),
            ...notFound,
            ...commonErrors,
          },
        },
        delete: {
          operationId: "deleteProfile",
          tags: ["Profiles"],
          summary: "Delete a profile",
          description: "Deleting a profile also removes its connected accounts.",
          parameters: [idParam("Profile ID.")],
          responses: {
            "200": jsonResponse("Deleted.", ref("Deleted")),
            ...notFound,
            ...commonErrors,
          },
        },
      },
      "/connect/{platform}": {
        get: {
          operationId: "getConnectUrl",
          tags: ["Connect"],
          summary: "Get a hosted connect link",
          description:
            "Returns a one-time link (valid 30 minutes) that connects a social account. Send your user to `authUrl`. When they finish, they are redirected to `redirectUrl` with `connected`, `accountId`, `accountIds` (comma separated), `profileId` and `username`, or with `error` and `platform` on failure.",
          parameters: [
            { name: "platform", in: "path", required: true, schema: ref("PlatformId") },
            { name: "profileId", in: "query", description: "Profile to add the account to. Defaults to your first profile.", schema: { type: "string" } },
            {
              name: "redirectUrl",
              in: "query",
              description: "Absolute http(s) URL to return the user to. Defaults to the dashboard. `redirect_url` is also accepted.",
              schema: { type: "string", format: "uri" },
            },
          ],
          responses: {
            "200": jsonResponse("Connect link.", {
              type: "object",
              required: ["authUrl", "expiresInSeconds"],
              properties: { authUrl: { type: "string", format: "uri" }, expiresInSeconds: { type: "integer", example: 1800 } },
            }),
            "400": errorResponse("Bad redirect URL (`invalid_redirect`) or the network is not configured (`connect_unavailable`)."),
            "404": errorResponse("Unknown platform (`unknown_platform`)."),
            ...commonErrors,
          },
        },
      },
      "/platforms": {
        get: {
          operationId: "listPlatforms",
          tags: ["Platforms"],
          summary: "List supported networks",
          responses: {
            "200": jsonResponse("Platforms.", {
              type: "object",
              required: ["platforms"],
              properties: { platforms: { type: "array", items: ref("Platform") } },
            }),
            ...commonErrors,
          },
        },
      },
      "/webhooks": {
        get: {
          operationId: "listWebhooks",
          tags: ["Webhooks"],
          summary: "List webhooks",
          responses: {
            "200": jsonResponse("Webhooks (without secrets).", {
              type: "object",
              required: ["webhooks"],
              properties: { webhooks: { type: "array", items: ref("Webhook") } },
            }),
            ...commonErrors,
          },
        },
        post: {
          operationId: "createWebhook",
          tags: ["Webhooks"],
          summary: "Create a webhook",
          description: `The response includes \`secret\` once. Every delivery has a \`${brand.webhookSignatureHeader}: t=<unix seconds>,v1=<hex HMAC-SHA256 of "<t>.<raw body>">\` header. Body: \`{ id, event, createdAt, data }\`.`,
          requestBody: jsonBody({
            type: "object",
            required: ["url"],
            properties: {
              url: { type: "string", format: "uri", description: "Public http(s) endpoint." },
              events: {
                type: "array",
                items: ref("WebhookEvent"),
                default: [],
                description: "Events to receive. Empty means all events.",
              },
            },
          }),
          responses: {
            "201": jsonResponse("Created. Store the secret now.", {
              type: "object",
              required: ["webhook"],
              properties: { webhook: { allOf: [ref("Webhook"), { type: "object", required: ["secret"], properties: { secret: { type: "string" } } }] } },
            }),
            "400": errorResponse("Invalid or private URL (`invalid_url`), invalid fields (`validation_error`) or more than 10 webhooks (`limit`)."),
            ...commonErrors,
          },
        },
      },
      "/webhooks/{id}": {
        delete: {
          operationId: "deleteWebhook",
          tags: ["Webhooks"],
          summary: "Delete a webhook",
          parameters: [idParam("Webhook ID.")],
          responses: {
            "200": jsonResponse("Deleted.", ref("Deleted")),
            ...notFound,
            ...commonErrors,
          },
        },
      },
      "/webhooks/{id}/test": {
        post: {
          operationId: "testWebhook",
          tags: ["Webhooks"],
          summary: "Send a test event",
          description: "Sends a `webhook.test` event to this endpoint and reports the outcome.",
          parameters: [idParam("Webhook ID.")],
          responses: {
            "200": jsonResponse("Delivery result.", {
              type: "object",
              required: ["delivered", "status", "error"],
              properties: {
                delivered: { type: "boolean" },
                status: { type: ["integer", "null"], description: "HTTP status returned by your endpoint." },
                error: { type: ["string", "null"] },
              },
            }),
            ...notFound,
            ...commonErrors,
          },
        },
      },
      "/usage": {
        get: {
          operationId: "getUsage",
          tags: ["Usage"],
          summary: "Plan and usage",
          responses: {
            "200": jsonResponse("Usage.", ref("Usage")),
            ...commonErrors,
          },
        },
      },
      "/analytics": {
        get: {
          operationId: "getAnalyticsOverview",
          tags: ["Analytics"],
          summary: "Analytics overview",
          description: `Totals, per-network breakdown, daily series, top posts and follower growth for posts published in the date range. ${ENGAGEMENT_NOTE}`,
          parameters: [
            ...rangeParams,
            queryParam("profileId", "Only accounts in this profile."),
            queryParam("platform", "Only this network.", ref("PlatformId")),
            queryParam("accountId", "Only this account."),
            queryParam("timezone", "IANA time zone used for the daily buckets. Default UTC.", { type: "string", default: "UTC" }),
          ],
          responses: {
            "200": jsonResponse("Analytics overview.", ref("AnalyticsOverview")),
            "400": errorResponse("Unknown time zone (`validation_error`)."),
            ...commonErrors,
          },
        },
      },
      "/analytics/posts/{id}": {
        get: {
          operationId: "getPostAnalytics",
          tags: ["Analytics"],
          summary: "Metrics of one post",
          description: `Latest metrics and history for every account the post went to. ${ENGAGEMENT_NOTE}`,
          parameters: [idParam("Post id.")],
          responses: {
            "200": jsonResponse("Post analytics.", ref("PostAnalytics")),
            ...notFound,
            ...commonErrors,
          },
        },
      },
      "/analytics/posts/{id}/refresh": {
        post: {
          operationId: "refreshPostAnalytics",
          tags: ["Analytics"],
          summary: "Fetch fresh metrics for a post now",
          description:
            "Queues the post's published targets for an immediate metrics fetch. Targets updated less than 5 minutes ago are skipped, so `queued` can be 0. Read the result with GET /analytics/posts/{id} a few seconds later.",
          parameters: [idParam("Post id.")],
          responses: {
            "200": jsonResponse(
              "Number of targets queued.",
              { type: "object", required: ["queued"], properties: { queued: { type: "integer", minimum: 0 } } },
            ),
            ...notFound,
            ...commonErrors,
          },
        },
      },
      "/analytics/accounts/{id}": {
        get: {
          operationId: "getAccountAnalytics",
          tags: ["Analytics"],
          summary: "Follower history of one account",
          description: "One snapshot per day of followers, following and post count, when the network reports them.",
          parameters: [idParam("Account id."), ...rangeParams],
          responses: {
            "200": jsonResponse("Account analytics.", ref("AccountAnalytics")),
            ...notFound,
            ...commonErrors,
          },
        },
      },
    },
    components: {
      securitySchemes: {
        bearerAuth: { type: "http", scheme: "bearer", description: `API key from the dashboard, e.g. \`${brand.apiKeyPrefix}...\`` },
      },
      schemas: {
        PlatformId: { type: "string", enum: [...PLATFORM_IDS] },
        PostStatus: { type: "string", enum: ["draft", "scheduled", "publishing", "published", "partial", "failed", "cancelled"] },
        TargetStatus: { type: "string", enum: ["pending", "publishing", "published", "failed", "cancelled"] },
        WebhookEvent: { type: "string", enum: WEBHOOK_EVENT_NAMES },
        MediaItem: {
          type: "object",
          required: ["url"],
          properties: {
            url: { type: "string", format: "uri", description: "Public URL of the file." },
            type: { type: "string", enum: ["image", "video"], description: "Guessed from the file extension if omitted." },
            altText: { type: "string", maxLength: 1500 },
          },
        },
        PlatformTarget: {
          type: "object",
          required: ["accountId"],
          properties: {
            accountId: { type: "string" },
            platform: { allOf: [ref("PlatformId")], description: "Optional. When set it must match the account's platform." },
            content: { type: "string", maxLength: 100000, description: "Overrides the post text for this account." },
            platformSpecificData: { type: "object", additionalProperties: true, description: platformOptionsDescription },
          },
        },
        CreatePostRequest: {
          type: "object",
          required: ["platforms"],
          properties: {
            content: { type: "string", maxLength: 100000, default: "" },
            mediaItems: { type: "array", maxItems: 20, items: ref("MediaItem"), default: [] },
            platforms: { type: "array", minItems: 1, items: ref("PlatformTarget") },
            scheduledFor: {
              type: "string",
              description: "ISO 8601 date time. Without an offset it is read in `timezone`. Omit to publish now.",
              example: "2026-12-01T09:00",
            },
            timezone: { type: "string", default: "UTC", description: "IANA time zone, e.g. America/New_York." },
            publishNow: { type: "boolean", description: "Publish immediately and ignore scheduledFor." },
            isDraft: { type: "boolean", description: "Save without publishing." },
            profileId: { type: "string", description: "Defaults to the first account's profile." },
            externalId: { type: "string", maxLength: 200, description: "Your own reference, returned in responses and webhooks." },
          },
        },
        PostTarget: {
          type: "object",
          required: ["id", "platform", "accountId", "status", "platformPostId", "platformPostUrl", "error", "attempts", "publishedAt", "metrics", "metricsUpdatedAt"],
          properties: {
            id: { type: "string" },
            platform: ref("PlatformId"),
            accountId: { type: ["string", "null"], description: "Null if the account was disconnected." },
            status: ref("TargetStatus"),
            platformPostId: { type: ["string", "null"] },
            platformPostUrl: { type: ["string", "null"] },
            error: { type: ["string", "null"] },
            attempts: { type: "integer" },
            publishedAt: { type: ["string", "null"], format: "date-time" },
            metrics: { oneOf: [ref("PostMetrics"), { type: "null" }], description: "Latest metrics from the network. Null until the first collection." },
            metricsUpdatedAt: { type: ["string", "null"], format: "date-time" },
            content: { type: "string", description: "Present when overridden for this account." },
            platformSpecificData: { type: "object", additionalProperties: true },
          },
        },
        Post: {
          type: "object",
          required: ["id", "status", "content", "mediaItems", "scheduledFor", "timezone", "profileId", "externalId", "source", "publishedAt", "createdAt", "platforms"],
          properties: {
            id: { type: "string" },
            status: ref("PostStatus"),
            content: { type: "string" },
            mediaItems: { type: "array", items: ref("MediaItem") },
            scheduledFor: { type: "string", format: "date-time" },
            timezone: { type: "string" },
            profileId: { type: ["string", "null"] },
            externalId: { type: ["string", "null"] },
            source: { type: "string", enum: ["api", "dashboard"] },
            publishedAt: { type: ["string", "null"], format: "date-time" },
            createdAt: { type: "string", format: "date-time" },
            platforms: { type: "array", items: ref("PostTarget") },
          },
        },
        Account: {
          type: "object",
          required: ["id", "platform", "profileId", "platformAccountId", "status", "createdAt"],
          properties: {
            id: { type: "string" },
            platform: ref("PlatformId"),
            profileId: { type: "string" },
            platformAccountId: { type: "string" },
            username: { type: ["string", "null"] },
            displayName: { type: ["string", "null"] },
            avatarUrl: { type: ["string", "null"] },
            status: { type: "string", enum: ["active", "expired", "error"], description: "`expired` means the user must reconnect." },
            lastError: { type: ["string", "null"] },
            tokenExpiresAt: { type: ["string", "null"], format: "date-time" },
            followers: { type: ["integer", "null"], description: "Latest follower count, when the network reports it." },
            usesOwnApp: { type: "boolean", description: "True when connected through your own developer app." },
            metadata: { type: "object", additionalProperties: true },
            createdAt: { type: "string", format: "date-time" },
          },
        },
        Profile: {
          type: "object",
          required: ["id", "name", "createdAt"],
          properties: {
            id: { type: "string" },
            name: { type: "string" },
            description: { type: ["string", "null"] },
            accountCount: { type: "integer", description: "Returned by list and get." },
            createdAt: { type: "string", format: "date-time" },
          },
        },
        Platform: {
          type: "object",
          required: ["id", "name", "connectType", "available", "usesOwnApp", "maxChars", "maxImages", "supportsVideo", "supportsTextOnly", "requiresMedia"],
          properties: {
            id: ref("PlatformId"),
            name: { type: "string" },
            connectType: { type: "string", enum: ["oauth", "credentials"] },
            available: { type: "boolean", description: "False when the network needs a developer app that is not configured." },
            usesOwnApp: { type: "boolean" },
            maxChars: { type: ["integer", "null"] },
            maxImages: { type: "integer" },
            supportsVideo: { type: "boolean" },
            supportsTextOnly: { type: "boolean" },
            requiresMedia: { type: "boolean" },
          },
        },
        Webhook: {
          type: "object",
          required: ["id", "url", "events", "active", "createdAt"],
          properties: {
            id: { type: "string" },
            url: { type: "string", format: "uri" },
            events: { type: "array", items: ref("WebhookEvent"), description: "Empty means all events." },
            active: { type: "boolean" },
            lastStatus: { type: ["integer", "null"] },
            lastError: { type: ["string", "null"] },
            lastDelivered: { type: ["string", "null"], format: "date-time" },
            createdAt: { type: "string", format: "date-time" },
          },
        },
        Usage: {
          type: "object",
          required: ["plan", "accounts", "postsThisMonth"],
          properties: {
            plan: { type: "string", enum: ["free", "starter", "growth", "scale"] },
            accounts: {
              type: "object",
              required: ["used", "limit"],
              properties: { used: { type: "integer" }, limit: { type: "integer" } },
            },
            postsThisMonth: {
              type: "object",
              required: ["used", "limit"],
              properties: { used: { type: "integer" }, limit: { type: ["integer", "null"], description: "Null means unlimited." } },
            },
          },
        },
        PostMetrics: {
          type: "object",
          description: "Unified post metrics. A field is missing when the network does not report it.",
          properties: {
            impressions: metricNumber("Times the post was shown."),
            reach: metricNumber("Unique accounts that saw the post."),
            views: metricNumber("Views (video views, or the network's view metric)."),
            likes: metricNumber("Likes, reactions, favourites, or the Reddit score."),
            comments: metricNumber("Comments or replies."),
            shares: metricNumber("Shares, reposts, retweets or boosts."),
            saves: metricNumber("Saves or bookmarks."),
            clicks: metricNumber("Link and post clicks."),
            quotes: metricNumber("Quote posts."),
          },
        },
        AnalyticsTotals: {
          type: "object",
          description: `Sums over published targets. A metric is null when no target reported it. ${ENGAGEMENT_NOTE}`,
          required: ["posts", "engagements", "engagementRate", "audience", "impressions", "reach", "views", "likes", "comments", "shares", "saves", "clicks", "quotes"],
          properties: {
            posts: { type: "integer", description: "Published targets (one per account a post went to)." },
            engagements: { type: "number" },
            audience: { type: ["number", "null"], description: "Per target impressions, else views, else reach, summed. The denominator of engagementRate." },
            engagementRate: { type: ["number", "null"], description: "Fraction, e.g. 0.0425 = 4.25%." },
            impressions: { type: ["number", "null"] },
            reach: { type: ["number", "null"] },
            views: { type: ["number", "null"] },
            likes: { type: ["number", "null"] },
            comments: { type: ["number", "null"] },
            shares: { type: ["number", "null"] },
            saves: { type: ["number", "null"] },
            clicks: { type: ["number", "null"] },
            quotes: { type: ["number", "null"] },
          },
        },
        AnalyticsOverview: {
          type: "object",
          required: ["range", "totals", "coverage", "byPlatform", "daily", "topPosts", "accounts"],
          properties: {
            range: {
              type: "object",
              required: ["from", "to", "timezone"],
              properties: { from: { type: "string", format: "date-time" }, to: { type: "string", format: "date-time" }, timezone: { type: "string" } },
            },
            totals: ref("AnalyticsTotals"),
            coverage: {
              type: "object",
              description: "How many published targets in the range already have metrics.",
              required: ["posts", "withMetrics"],
              properties: { posts: { type: "integer" }, withMetrics: { type: "integer" } },
            },
            byPlatform: {
              type: "array",
              description: "Totals per network, most engagements first.",
              items: { allOf: [ref("AnalyticsTotals"), { type: "object", required: ["platform"], properties: { platform: ref("PlatformId") } }] },
            },
            daily: {
              type: "array",
              description: "One entry per day in the range (by publish date, in `timezone`). Missing metrics count as 0 here.",
              items: {
                type: "object",
                required: ["date", "posts", "engagements", "impressions", "views"],
                properties: {
                  date: { type: "string", format: "date" },
                  posts: { type: "integer" },
                  engagements: { type: "number" },
                  impressions: { type: "number" },
                  views: { type: "number" },
                },
              },
            },
            topPosts: {
              type: "array",
              description: "Up to 10 published targets with metrics, most engagements first.",
              items: {
                type: "object",
                required: ["postId", "targetId", "platform", "accountId", "content", "url", "publishedAt", "metrics", "engagements", "engagementRate"],
                properties: {
                  postId: { type: "string" },
                  targetId: { type: "string" },
                  platform: ref("PlatformId"),
                  accountId: { type: ["string", "null"] },
                  content: { type: "string", description: "First 280 characters." },
                  url: { type: ["string", "null"] },
                  publishedAt: { type: ["string", "null"], format: "date-time" },
                  metrics: ref("PostMetrics"),
                  engagements: { type: "number" },
                  engagementRate: { type: ["number", "null"] },
                },
              },
            },
            accounts: {
              type: "array",
              description: "Follower growth of each matching account.",
              items: {
                type: "object",
                required: ["accountId", "platform", "name", "followers", "followersChange", "series", "metricsError"],
                properties: {
                  accountId: { type: "string" },
                  platform: ref("PlatformId"),
                  name: { type: ["string", "null"] },
                  followers: { type: ["integer", "null"] },
                  followersChange: { type: ["integer", "null"], description: "Last minus first follower count in the range; null with fewer than 2 snapshots." },
                  series: {
                    type: "array",
                    items: {
                      type: "object",
                      required: ["date", "followers"],
                      properties: { date: { type: "string", format: "date" }, followers: { type: "integer" } },
                    },
                  },
                  metricsError: { type: ["string", "null"], description: "Last error while reading account metrics." },
                },
              },
            },
          },
        },
        PostAnalytics: {
          type: "object",
          required: ["postId", "content", "publishedAt", "totals", "platforms"],
          properties: {
            postId: { type: "string" },
            content: { type: "string" },
            publishedAt: { type: ["string", "null"], format: "date-time" },
            totals: ref("AnalyticsTotals"),
            platforms: {
              type: "array",
              items: {
                type: "object",
                required: [
                  "targetId", "platform", "accountId", "status", "url", "publishedAt", "metrics", "engagements", "engagementRate",
                  "metricsUpdatedAt", "nextUpdateAt", "metricsError", "supported", "history",
                ],
                properties: {
                  targetId: { type: "string" },
                  platform: ref("PlatformId"),
                  accountId: { type: ["string", "null"] },
                  status: ref("TargetStatus"),
                  url: { type: ["string", "null"] },
                  publishedAt: { type: ["string", "null"], format: "date-time" },
                  metrics: { oneOf: [ref("PostMetrics"), { type: "null" }] },
                  engagements: { type: "number" },
                  engagementRate: { type: ["number", "null"] },
                  metricsUpdatedAt: { type: ["string", "null"], format: "date-time" },
                  nextUpdateAt: { type: ["string", "null"], format: "date-time", description: "Null when collection has stopped (posts older than 90 days or unsupported networks)." },
                  metricsError: { type: ["string", "null"] },
                  supported: { type: "boolean", description: "False when the network does not report post metrics." },
                  history: {
                    type: "array",
                    description: "Snapshots over time, oldest first (up to 200).",
                    items: { allOf: [ref("PostMetrics"), { type: "object", required: ["capturedAt"], properties: { capturedAt: { type: "string", format: "date-time" } } }] },
                  },
                },
              },
            },
          },
        },
        AccountAnalytics: {
          type: "object",
          required: ["accountId", "platform", "name", "followers", "followersChange", "supported", "metricsError", "series"],
          properties: {
            accountId: { type: "string" },
            platform: ref("PlatformId"),
            name: { type: ["string", "null"] },
            followers: { type: ["integer", "null"] },
            followersChange: { type: ["integer", "null"] },
            supported: { type: "boolean", description: "False when the network does not report account metrics." },
            metricsError: { type: ["string", "null"] },
            series: {
              type: "array",
              items: {
                type: "object",
                required: ["date", "followers", "following", "posts"],
                properties: {
                  date: { type: "string", format: "date" },
                  followers: { type: ["integer", "null"] },
                  following: { type: ["integer", "null"] },
                  posts: { type: ["integer", "null"] },
                },
              },
            },
          },
        },
        Deleted: { type: "object", required: ["deleted"], properties: { deleted: { type: "boolean", const: true } } },
        WebhookPayload: {
          type: "object",
          description: "Body of every webhook delivery.",
          required: ["id", "event", "createdAt", "data"],
          properties: {
            id: { type: "string" },
            event: { type: "string", description: "One of the WebhookEvent values, or `webhook.test`." },
            createdAt: { type: "string", format: "date-time" },
            data: { description: "A Post for post.* events, an Account for account.* events." },
          },
        },
        Error: {
          type: "object",
          required: ["error"],
          properties: {
            error: {
              type: "object",
              required: ["code", "message"],
              properties: {
                code: {
                  type: "string",
                  description:
                    "unauthorized, invalid_json, validation_error, platform_rejected, plan_limit, not_found, unknown_platform, invalid_redirect, connect_unavailable, invalid_url, limit, internal_error",
                },
                message: { type: "string" },
                details: { description: "Extra information, e.g. per-account problems for 422 responses." },
              },
            },
          },
        },
      },
    },
  };
}
