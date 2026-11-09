import Link from "next/link";
import { brand } from "@/lib/brand";
import { appUrl } from "@/lib/env";
import { platformList } from "@/lib/platforms";
import { CodeBlock } from "@/components/ui";

export const metadata = { title: "API documentation" };

const toc = [
  ["quickstart", "Quickstart"],
  ["auth", "Authentication"],
  ["connect", "Connecting accounts"],
  ["posts", "Creating posts"],
  ["platform-options", "Platform options"],
  ["manage-posts", "Managing posts"],
  ["media", "Uploading media"],
  ["analytics", "Analytics"],
  ["accounts", "Accounts and profiles"],
  ["webhooks", "Webhooks"],
  ["sdks", "SDKs and OpenAPI"],
  ["mcp", "AI agents (MCP)"],
  ["n8n", "n8n and no-code"],
  ["errors", "Errors and limits"],
  ["networks", "Network setup"],
];

const platformOptions: { id: string; options: [string, string][] }[] = [
  { id: "twitter", options: [["threadItems", "string[]: extra posts published as a thread under the first one"], ["replyToId", "post ID to reply to"], ["allowLongPost", "boolean: skip the 280 character check (X Premium)"]] },
  { id: "linkedin", options: [["link", "URL to share as an article card (text posts only)"], ["linkTitle / linkDescription", "article card text"], ["title", "video title"], ["visibility", "PUBLIC (default) or CONNECTIONS"], ["organizationUrn", "post as a company page, e.g. urn:li:organization:123 (needs LinkedIn Community Management API access)"]] },
  { id: "facebook", options: [["link", "URL to attach to a text post"], ["title", "video title"], ["firstComment", "comment added right after publishing"]] },
  { id: "instagram", options: [["contentType", "\"story\" to post a story; default is feed / reel"], ["shareToFeed", "boolean: also show reels in the feed (default true)"], ["coverUrl", "reel cover image URL"], ["thumbOffset", "reel cover frame in ms"], ["firstComment", "comment added right after publishing"]] },
  { id: "threads", options: [["link", "link attachment for text posts"], ["replyChain", "string[]: replies published under the post"]] },
  { id: "tiktok", options: [["privacyLevel", "PUBLIC_TO_EVERYONE, MUTUAL_FOLLOW_FRIENDS, FOLLOWER_OF_CREATOR or SELF_ONLY"], ["disableComment / disableDuet / disableStitch", "booleans"], ["videoCoverTimestampMs", "cover frame in ms"]] },
  { id: "youtube", options: [["title", "video title (default: first line of content)"], ["visibility", "public (default), unlisted or private"], ["tags", "string[]"], ["categoryId", "YouTube category (default 22)"], ["madeForKids", "boolean (default false)"]] },
  { id: "pinterest", options: [["boardId", "board to pin to (default: first board)"], ["title", "pin title"], ["link", "destination URL"]] },
  { id: "reddit", options: [["subreddit", "required, without r/"], ["title", "required"], ["url", "submit a link post instead of a text post"]] },
  { id: "googlebusiness", options: [["topicType", "STANDARD (default), EVENT or OFFER"], ["callToActionType / callToActionUrl", "button: BOOK, ORDER, SHOP, LEARN_MORE, SIGN_UP or CALL (CALL needs no URL)"], ["eventTitle / eventStart / eventEnd", "for EVENT and OFFER posts, YYYY-MM-DDTHH:mm in the business's local time"], ["couponCode / redeemUrl / terms", "OFFER details"], ["languageCode", "default en"]] },
  { id: "bluesky", options: [["replyToUri", "at:// URI of a post to reply to"], ["langs", "string[] of language codes"]] },
  { id: "mastodon", options: [["visibility", "public, unlisted, private or direct"], ["spoilerText", "content warning"], ["sensitive", "boolean"], ["language", "ISO 639 code"]] },
  { id: "telegram", options: [["parseMode", "HTML or MarkdownV2"], ["disableLinkPreview", "boolean"], ["disableNotification", "boolean: send silently"]] },
  { id: "discord", options: [["username", "override the webhook name"], ["avatarUrl", "override the webhook avatar"], ["allowMentions", "boolean: allow @everyone and role mentions"]] },
];

export default function Docs() {
  const base = `${appUrl()}/api/v1`;
  const key = `${brand.apiKeyPrefix}xxxxxxxx`;
  const names = new Map(platformList.map((p) => [p.id, p.name]));
  return (
    <div className="mx-auto flex max-w-6xl gap-10 px-4 py-12">
      <aside className="sticky top-24 hidden h-fit w-48 shrink-0 lg:block">
        <nav className="space-y-1 text-sm">
          {toc.map(([id, label]) => (
            <a key={id} href={`#${id}`} className="block rounded px-2 py-1 text-ink-2 hover:bg-wash hover:text-ink">{label}</a>
          ))}
        </nav>
      </aside>
      <article className="prose-docs min-w-0 flex-1">
        <h1 className="text-4xl font-bold tracking-tight">API documentation</h1>
        <p>
          {brand.name} is a REST API. Requests and responses are JSON. The base URL is <code>{base}</code>.
        </p>

        <h2 id="quickstart">Quickstart</h2>
        <ol className="list-decimal space-y-1 pl-5 text-ink-2">
          <li><Link href="/signup" className="text-brand">Create an account</Link> and an API key in the dashboard.</li>
          <li>Connect a social account in the dashboard, or with the <a href="#connect" className="text-brand">connect API</a>.</li>
          <li>Copy the account&apos;s <code>accountId</code> and send a post:</li>
        </ol>
        <CodeBlock>{`curl -X POST ${base}/posts \\
  -H "Authorization: Bearer ${key}" \\
  -H "Content-Type: application/json" \\
  -d '{
    "content": "Hello world",
    "platforms": [{ "platform": "bluesky", "accountId": "ACCOUNT_ID" }],
    "publishNow": true
  }'`}</CodeBlock>

        <h2 id="auth">Authentication</h2>
        <p>Send your API key in the <code>Authorization</code> header as a bearer token. Keys are secret: call the API from your server only.</p>
        <CodeBlock>{`Authorization: Bearer ${key}`}</CodeBlock>

        <h2 id="connect">Connecting accounts</h2>
        <p>
          Ask for a connect link, send your user to it, and we send them back to your <code>redirectUrl</code> when they finish. Links work once and expire after 30 minutes.
          OAuth networks redirect straight to the network. Credential networks (Bluesky, Mastodon, Telegram, Discord) show a short hosted form.
        </p>
        <CodeBlock>{`GET ${base}/connect/{platform}?profileId=PROFILE_ID&redirectUrl=https://yourapp.com/connected

200 OK
{ "authUrl": "${appUrl()}/connect/linkedin?state=...", "expiresInSeconds": 1800 }`}</CodeBlock>
        <p>On success the user lands on:</p>
        <CodeBlock>{`https://yourapp.com/connected?connected=linkedin&accountId=ACC_ID&accountIds=ACC_ID&profileId=PROFILE_ID&username=jane`}</CodeBlock>
        <p>
          On failure we add <code>error</code> and <code>platform</code> instead. Facebook can return several Pages from one login, so <code>accountIds</code> is a comma separated list.
          Omit <code>profileId</code> to use your default profile. Valid platforms: {platformList.map((p) => p.id).join(", ")}.
        </p>

        <h2 id="posts">Creating posts</h2>
        <p><code>POST /posts</code> creates a post for one or more accounts. It returns <code>201</code> with the post. Publishing happens in the background; use webhooks or <code>GET /posts/:id</code> to see the result.</p>
        <table>
          <thead><tr><th>Field</th><th>Type</th><th>Description</th></tr></thead>
          <tbody>
            <tr><td><code>content</code></td><td>string</td><td>Post text. Can be overridden per account.</td></tr>
            <tr><td><code>platforms</code></td><td>array, required</td><td><code>{"{ platform, accountId, content?, platformSpecificData? }"}</code> for each target account.</td></tr>
            <tr><td><code>mediaItems</code></td><td>array</td><td><code>{"{ url, type?: \"image\" | \"video\", altText? }"}</code>. URLs must be public. Type is guessed from the file extension if omitted.</td></tr>
            <tr><td><code>scheduledFor</code></td><td>string</td><td>ISO date time. Without an offset it is read in <code>timezone</code>. Omit to publish now.</td></tr>
            <tr><td><code>timezone</code></td><td>string</td><td>IANA time zone, default <code>UTC</code>.</td></tr>
            <tr><td><code>publishNow</code></td><td>boolean</td><td>Publish immediately and ignore <code>scheduledFor</code>.</td></tr>
            <tr><td><code>isDraft</code></td><td>boolean</td><td>Save without publishing.</td></tr>
            <tr><td><code>profileId</code></td><td>string</td><td>Optional, for filtering. Defaults to the first account&apos;s profile.</td></tr>
            <tr><td><code>externalId</code></td><td>string</td><td>Your own reference, returned in responses and webhooks.</td></tr>
          </tbody>
        </table>
        <CodeBlock>{`POST ${base}/posts
{
  "content": "Launch day! 🚀 #buildinpublic",
  "mediaItems": [{ "url": "https://cdn.example.com/launch.mp4" }],
  "platforms": [
    { "platform": "tiktok", "accountId": "acc_tt", "platformSpecificData": { "privacyLevel": "PUBLIC_TO_EVERYONE" } },
    { "platform": "youtube", "accountId": "acc_yt", "platformSpecificData": { "title": "Launch day", "visibility": "public" } },
    { "platform": "twitter", "accountId": "acc_x", "content": "Launch day! Thread below 👇",
      "platformSpecificData": { "threadItems": ["What we built...", "What is next..."] } }
  ],
  "scheduledFor": "2026-12-01T09:00",
  "timezone": "Europe/Madrid"
}`}</CodeBlock>
        <p>The response lists each target with its status:</p>
        <CodeBlock>{`{
  "post": {
    "id": "cm4...", "status": "scheduled", "scheduledFor": "2026-12-01T08:00:00.000Z",
    "platforms": [
      { "id": "cm5...", "platform": "tiktok", "accountId": "acc_tt", "status": "pending",
        "platformPostId": null, "platformPostUrl": null, "error": null, "attempts": 0 }
    ]
  }
}`}</CodeBlock>
        <p>Post statuses: <code>draft</code>, <code>scheduled</code>, <code>publishing</code>, <code>published</code>, <code>partial</code> (some networks failed), <code>failed</code>, <code>cancelled</code>. Temporary network errors are retried up to 3 times (after 1, 5 and 15 minutes).</p>
        <p>
          Send an <code>Idempotency-Key</code> header (any unique string, up to 255 characters) to retry safely: a second request with the same key returns
          the first post with status <code>200</code> and the header <code>Idempotent-Replayed: true</code> instead of creating a duplicate.
        </p>
        <p>We check every post against each network&apos;s rules before accepting it. Problems return <code>422</code> with a list per account, so you can show the user what to fix.</p>

        <h2 id="platform-options">Platform options</h2>
        <p>Pass these in <code>platformSpecificData</code> for a target.</p>
        <table>
          <thead><tr><th>Network</th><th>Option</th><th>Meaning</th></tr></thead>
          <tbody>
            {platformOptions.flatMap((p) =>
              p.options.map(([name, desc], i) => (
                <tr key={`${p.id}-${name}`}>
                  <td>{i === 0 ? names.get(p.id as never) : ""}</td>
                  <td><code>{name}</code></td>
                  <td>{desc}</td>
                </tr>
              )),
            )}
          </tbody>
        </table>
        <table>
          <thead><tr><th>Network</th><th>Max text</th><th>Media</th></tr></thead>
          <tbody>
            {platformList.map((p) => (
              <tr key={p.id}>
                <td>{p.name}</td>
                <td>{p.maxChars ? p.maxChars.toLocaleString() : "n/a"}</td>
                <td>
                  {p.maxImages ? `up to ${p.maxImages} image${p.maxImages > 1 ? "s" : ""}` : "no images"}
                  {p.supportsVideo ? ", video" : ""}
                  {p.requiresMedia ? " (media required)" : ""}
                </td>
              </tr>
            ))}
          </tbody>
        </table>

        <h2 id="manage-posts">Managing posts</h2>
        <table>
          <tbody>
            <tr><td><code>GET /posts?status=&amp;profileId=&amp;limit=&amp;cursor=</code></td><td>List posts, newest first. Use <code>nextCursor</code> to page.</td></tr>
            <tr><td><code>GET /posts/:id</code></td><td>Get one post with per-network results.</td></tr>
            <tr><td><code>DELETE /posts/:id</code></td><td>Cancel a scheduled post, or delete a finished one from history. It does not delete the post from the network.</td></tr>
            <tr><td><code>POST /posts/:id/retry</code></td><td>Queue failed targets again.</td></tr>
          </tbody>
        </table>

        <h2 id="media">Uploading media</h2>
        <p>
          Posts take media as public URLs. If your files are not online yet, upload them first and use the returned <code>url</code> in{" "}
          <code>mediaItems</code>. Allowed: JPEG, PNG, GIF and WebP up to 20 MB, MP4, MOV and WebM up to 512 MB. We check that the file content matches its type.
        </p>
        <CodeBlock>{`# Raw bytes (best for large videos)
curl -X POST "${base}/media?filename=launch.mp4" \\
  -H "Authorization: Bearer ${key}" -H "Content-Type: video/mp4" \\
  --data-binary @launch.mp4

# Or a form upload
curl -X POST ${base}/media -H "Authorization: Bearer ${key}" -F "file=@photo.jpg"

201 Created
{ "media": { "id": "...", "url": "${appUrl()}/media/.../photo.jpg", "type": "image", "size": 48213 } }`}</CodeBlock>
        <p>
          <code>GET /media</code> lists your files and <code>DELETE /media/:id</code> removes one. Deleting a file does not remove posts that are already published.
        </p>

        <h2 id="analytics">Analytics</h2>
        <p>
          We collect metrics for every published post automatically: about 20 minutes after it goes live, then every 30 minutes for the first 6 hours, every 2 hours
          for 2 days, twice a day for a week, daily for a month, and weekly up to 90 days. Follower counts are read twice a day. Every post target in the API
          includes its latest <code>metrics</code> and <code>metricsUpdatedAt</code>.
        </p>
        <table>
          <tbody>
            <tr><td><code>GET /analytics?days=30&amp;platform=&amp;profileId=&amp;accountId=&amp;timezone=</code></td><td>Totals, per-network breakdown, daily series, top 10 posts and follower changes for posts published in the range. Use <code>from</code>/<code>to</code> (YYYY-MM-DD) instead of <code>days</code> for a custom range.</td></tr>
            <tr><td><code>GET /analytics/posts/:id</code></td><td>Metrics per network for one post, with history.</td></tr>
            <tr><td><code>POST /analytics/posts/:id/refresh</code></td><td>Fetch fresh numbers now (each network at most once per 5 minutes).</td></tr>
            <tr><td><code>GET /analytics/accounts/:id?days=90</code></td><td>Daily follower history of one account.</td></tr>
          </tbody>
        </table>
        <p>
          Metric fields: <code>impressions</code>, <code>reach</code>, <code>views</code>, <code>likes</code>, <code>comments</code>, <code>shares</code>, <code>saves</code>, <code>clicks</code>,{" "}
          <code>quotes</code>. A field is missing when the network does not report it. <code>engagements</code> = likes + comments + shares + saves + quotes, and{" "}
          <code>engagementRate</code> = engagements ÷ <code>audience</code>, where audience is each post&apos;s impressions (or views, or reach) summed.
        </p>
        <CodeBlock>{`GET ${base}/analytics/posts/POST_ID

{
  "postId": "cm4...",
  "totals": { "posts": 2, "views": 5400, "likes": 310, "comments": 22, "engagements": 351, "engagementRate": 0.065 },
  "platforms": [
    { "platform": "youtube", "metrics": { "views": 5000, "likes": 300, "comments": 12 },
      "engagements": 312, "engagementRate": 0.0624, "metricsUpdatedAt": "2026-12-01T10:30:00.000Z", "history": [ ... ] }
  ]
}`}</CodeBlock>
        <table>
          <thead><tr><th>Network</th><th>What is collected</th></tr></thead>
          <tbody>
            {platformList.map((p) => (
              <tr key={p.id}>
                <td>{p.name}</td>
                <td>
                  {p.analytics?.fetchPostMetrics ? "Post metrics" : "No post metrics"}
                  {p.analytics?.fetchAccountMetrics ? " and followers" : ""}. {p.analytics?.note}
                </td>
              </tr>
            ))}
          </tbody>
        </table>

        <h2 id="accounts">Accounts and profiles</h2>
        <p>A profile groups the accounts of one of your customers or brands.</p>
        <table>
          <tbody>
            <tr><td><code>GET /accounts?profileId=&amp;platform=</code></td><td>List connected accounts. <code>status</code> is <code>active</code> or <code>expired</code> (the user must reconnect).</td></tr>
            <tr><td><code>GET /accounts/:id</code></td><td>Get one account.</td></tr>
            <tr><td><code>DELETE /accounts/:id</code></td><td>Disconnect an account and delete its tokens.</td></tr>
            <tr><td><code>GET /profiles</code> · <code>POST /profiles</code></td><td>List or create profiles: <code>{"{ name, description? }"}</code>.</td></tr>
            <tr><td><code>GET|PATCH|DELETE /profiles/:id</code></td><td>Read, rename or delete a profile (deleting removes its accounts).</td></tr>
            <tr><td><code>GET /platforms</code></td><td>Which networks you can connect, and their limits.</td></tr>
            <tr><td><code>GET /usage</code></td><td>Your plan, accounts used and posts this month.</td></tr>
          </tbody>
        </table>

        <h2 id="webhooks">Webhooks</h2>
        <p>
          Events: <code>post.published</code>, <code>post.partial</code>, <code>post.failed</code>, <code>account.connected</code>, <code>account.disconnected</code>, <code>account.expired</code>.
          Manage endpoints in the dashboard or with <code>GET|POST /webhooks</code>, <code>DELETE /webhooks/:id</code> and <code>POST /webhooks/:id/test</code>.
        </p>
        <CodeBlock>{`POST /webhooks
{ "url": "https://yourapp.com/hooks/social", "events": ["post.published", "post.failed"] }

→ { "webhook": { "id": "...", "secret": "whsec_..." } }   // the secret is only shown once`}</CodeBlock>
        <p>Every delivery has a <code>{brand.webhookSignatureHeader}</code> header: <code>t=TIMESTAMP,v1=HMAC</code>, where HMAC is the hex SHA-256 HMAC of <code>TIMESTAMP + &quot;.&quot; + rawBody</code> with your secret.</p>
        <CodeBlock>{`import crypto from "node:crypto";

export function verify(rawBody, header, secret) {
  const { t, v1 } = Object.fromEntries(header.split(",").map((p) => p.split("=")));
  const expected = crypto.createHmac("sha256", secret).update(\`\${t}.\${rawBody}\`).digest("hex");
  const fresh = Math.abs(Date.now() / 1000 - Number(t)) < 300;
  return fresh && crypto.timingSafeEqual(Buffer.from(v1), Buffer.from(expected));
}`}</CodeBlock>

        <h2 id="sdks">SDKs and OpenAPI</h2>
        <p>
          Official SDKs have no dependencies and are typed. The full API is also described as OpenAPI 3.1 at <a className="text-brand" href="/openapi.json">/openapi.json</a>, so you can generate a client in any
          language or import it into Postman, Zapier, Make or a custom GPT action.
        </p>
        <h3>Node.js / TypeScript</h3>
        <CodeBlock>{`npm install @fanout/node

import { Fanout } from "@fanout/node";
const fanout = new Fanout({ apiKey: process.env.FANOUT_API_KEY, baseUrl: "${appUrl()}" });

const post = await fanout.posts.create(
  { content: "Hello!", platforms: [{ accountId: "ACCOUNT_ID" }], publishNow: true },
  { idempotencyKey: "launch-2026-12-01" },
);`}</CodeBlock>
        <h3>Python</h3>
        <CodeBlock>{`pip install fanout

from fanout import Fanout
client = Fanout(api_key="${key}", base_url="${appUrl()}")
post = client.posts.create(platforms=[{"accountId": "ACCOUNT_ID"}], content="Hello!", publish_now=True)`}</CodeBlock>
        <p>Both SDKs include a webhook signature helper: <code>verifyWebhookSignature</code> (Node) and <code>verify_webhook_signature</code> (Python).</p>

        <h2 id="mcp">AI agents (MCP)</h2>
        <p>
          {brand.name} is a remote Model Context Protocol server. Any MCP client (Claude, Cursor, VS Code, custom agents) can list accounts, publish, schedule, check results and get connect
          links. Server URL: <code>{appUrl()}/api/mcp</code>, with your API key as a bearer token.
        </p>
        <CodeBlock>{`# Claude Code
claude mcp add --transport http ${brand.name.toLowerCase()} ${appUrl()}/api/mcp --header "Authorization: Bearer ${key}"

# Cursor / VS Code / other clients (mcp.json)
{
  "mcpServers": {
    "${brand.name.toLowerCase()}": {
      "url": "${appUrl()}/api/mcp",
      "headers": { "Authorization": "Bearer ${key}" }
    }
  }
}`}</CodeBlock>
        <p>
          Tools: <code>list_accounts</code>, <code>create_post</code>, <code>get_post</code>, <code>list_posts</code>, <code>cancel_post</code>, <code>retry_post</code>,{" "}
          <code>get_connect_link</code>, <code>get_analytics</code>, <code>get_post_analytics</code>, <code>list_platforms</code>, <code>list_profiles</code>, <code>get_usage</code>. Then ask your
          agent: &quot;Post this changelog to LinkedIn and Bluesky tomorrow at 9am&quot; or &quot;Which of last month&apos;s posts did best, and why?&quot;
        </p>

        <h2 id="n8n">n8n and no-code</h2>
        <p>
          Install the community node <code>n8n-nodes-fanout</code> in n8n (Settings &gt; Community nodes). It has an action node for posts, accounts, profiles and connect links, and a trigger
          node that starts a workflow when a post is published or fails. For Zapier, Make and others, use an HTTP request step with the API key, or import <code>/openapi.json</code>.
        </p>

        <h2 id="errors">Errors and limits</h2>
        <p>Errors use HTTP status codes and a JSON body: <code>{"{ \"error\": { \"code\", \"message\", \"details\" } }"}</code>.</p>
        <table>
          <tbody>
            <tr><td><code>400</code></td><td>Invalid JSON or fields (<code>validation_error</code>).</td></tr>
            <tr><td><code>401</code></td><td>Missing or invalid API key.</td></tr>
            <tr><td><code>402</code></td><td>Plan limit reached (<code>plan_limit</code>). Upgrade in the dashboard.</td></tr>
            <tr><td><code>404</code></td><td>Not found, or it belongs to another user.</td></tr>
            <tr><td><code>413</code></td><td>File too large, or your media storage is full (<code>too_large</code>).</td></tr>
            <tr><td><code>415</code></td><td>File type not allowed, or the file content does not match its type (<code>unsupported_type</code>).</td></tr>
            <tr><td><code>422</code></td><td>A network cannot accept the post (<code>platform_rejected</code>). <code>details</code> lists problems per account.</td></tr>
            <tr><td><code>429</code></td><td>Too many requests (<code>rate_limited</code>). Wait for the seconds in the <code>Retry-After</code> header.</td></tr>
          </tbody>
        </table>
        <p>
          Rate limits: 300 requests per minute per account, of which at most 60 can be writes (POST, PATCH, DELETE). Every response has{" "}
          <code>X-RateLimit-Limit</code>, <code>X-RateLimit-Remaining</code> and <code>X-RateLimit-Reset</code> headers. Need more? Email us.
        </p>

        <h2 id="networks">Network setup</h2>
        <p>Some networks review developer apps before they allow public posting. This is what each one needs:</p>
        <ul>
          {platformList.map((p) => (
            <li key={p.id}>
              <strong>{p.name}:</strong> {p.kind === "credentials" ? ("helpText" in p ? p.helpText : "") : p.setupNote ?? "OAuth app required."}
            </li>
          ))}
        </ul>
      </article>
    </div>
  );
}
