# Fanout Node.js SDK

Typed, zero-dependency client for the Fanout unified social media API. Publish and schedule posts to 14 networks with one call.

> **Placeholders:** the package name `@fanout/node` and the default base URL `https://api.example.com` are placeholders. Change `name` in `package.json` to your npm scope and `DEFAULT_BASE_URL` in `src/index.ts` to your API domain before you publish.

## Install

```bash
npm install @fanout/node
```

Requires Node.js 18 or later (uses the built-in `fetch`).

## Quick start

```ts
import { Fanout } from "@fanout/node";

const fanout = new Fanout({
  apiKey: process.env.FANOUT_API_KEY!,
  baseUrl: "https://api.yourdomain.com", // or set FANOUT_BASE_URL
});

const accounts = await fanout.accounts.list();

const post = await fanout.posts.create({
  content: "We just shipped dark mode 🌙",
  mediaItems: [{ url: "https://cdn.example.com/dark.png" }],
  platforms: accounts.map((a) => ({ platform: a.platform, accountId: a.id })),
  publishNow: true,
});

console.log(post.id, post.status);
```

Keep your API key on the server. Never ship it to a browser.

## Schedule a post

```ts
await fanout.posts.create({
  content: "Doors open at 9!",
  platforms: [{ platform: "linkedin", accountId: "acc_123" }],
  scheduledFor: "2026-12-01T09:00", // no offset: read in `timezone`
  timezone: "America/New_York",
});

// A Date also works (sent as UTC):
await fanout.posts.create({ content: "Later", platforms: [{ accountId: "acc_123" }], scheduledFor: new Date(Date.now() + 3600_000) });
```

Per-network options go in `platformSpecificData`:

```ts
await fanout.posts.create({
  content: "Launch video",
  mediaItems: [{ url: "https://cdn.example.com/launch.mp4" }],
  platforms: [
    { platform: "youtube", accountId: "acc_yt", platformSpecificData: { title: "Launch day", visibility: "unlisted" } },
    { platform: "tiktok", accountId: "acc_tt", platformSpecificData: { privacyLevel: "PUBLIC_TO_EVERYONE" } },
    { platform: "twitter", accountId: "acc_x", content: "Launch day 🧵", platformSpecificData: { threadItems: ["Part 2", "Part 3"] } },
  ],
});
```

## Track results

```ts
const fresh = await fanout.posts.get(post.id);
for (const target of fresh.platforms) {
  console.log(target.platform, target.status, target.platformPostUrl ?? target.error);
}

// Every post, page by page:
for await (const p of fanout.posts.iterate({ status: "failed" })) {
  await fanout.posts.retry(p.id);
}
```

## Analytics

Metrics are collected from each network on a schedule (often for new posts, then less often, for 90 days).
`engagements` = likes + comments + shares + saves + quotes; `engagementRate` = engagements / (impressions, else views, else reach).

```ts
const overview = await fanout.analytics.overview({ days: 30, platform: "instagram", timezone: "Europe/Madrid" });
console.log(overview.totals.engagements, overview.totals.engagementRate); // e.g. 1520, 0.034
for (const p of overview.topPosts) console.log(p.platform, p.engagements, p.url);

const stats = await fanout.analytics.post(post.id); // per-network metrics and history
await fanout.analytics.refreshPost(post.id);         // ask for fresh numbers now
const followers = await fanout.analytics.account("acc_123", { days: 90 });
```

## Connect your users' accounts

```ts
// 1. Ask for a hosted connect link (valid 30 minutes, works once)
const { authUrl } = await fanout.connect.getUrl("instagram", {
  profileId: "prof_123", // optional: group accounts per customer
  redirectUrl: "https://app.example.com/social/connected",
});

// 2. Redirect your user to authUrl.
// 3. They come back to:
//    https://app.example.com/social/connected?connected=instagram&accountId=acc_...&profileId=prof_123
//    or ...?error=...&platform=instagram on failure. Store accountId.
```

Profiles keep each customer's accounts apart:

```ts
const profile = await fanout.profiles.create({ name: "Acme Coffee" });
const theirAccounts = await fanout.accounts.list({ profileId: profile.id });
```

## Errors

Every failed request throws a `FanoutError`:

```ts
import { FanoutError } from "@fanout/node";

try {
  await fanout.posts.create({ content: "x".repeat(400), platforms: [{ accountId: "acc_x" }] });
} catch (err) {
  if (err instanceof FanoutError) {
    console.log(err.status);  // 422
    console.log(err.code);    // "validation_error"
    console.log(err.details); // [{ accountId, platform, errors: ["X posts are limited to 280 characters..."] }]
  }
}
```

| `status` | `code` | Meaning |
|---|---|---|
| 0 | `network_error` | Could not reach the API (or timeout) |
| 400 | `validation_error`, `invalid_json`, `invalid_redirect`, `connect_unavailable`, `invalid_url` | Bad input |
| 401 | `unauthorized` | Missing or invalid API key |
| 402 | `plan_limit` | Plan limit reached |
| 404 | `not_found`, `unknown_platform` | Not found |
| 422 | `validation_error` | A network cannot accept the post (`details` per account) |

GET requests are retried up to 2 times on network errors, 429 and 5xx (honouring `Retry-After`). POST, PATCH and DELETE are never retried automatically. Change this with `maxRetries`; change the timeout with `timeoutMs` (default 60 s).

## Webhooks

```ts
const hook = await fanout.webhooks.create({
  url: "https://app.example.com/webhooks/fanout",
  events: ["post.published", "post.failed", "account.expired"], // empty = all events
});
console.log(hook.secret); // shown once: store it
```

Verify each delivery with the raw body. Example with Express:

```ts
import express from "express";
import { constructWebhookEvent, FanoutError } from "@fanout/node";

const app = express();

app.post("/webhooks/fanout", express.raw({ type: "application/json" }), (req, res) => {
  try {
    const event = constructWebhookEvent(req.body, req.header("X-Fanout-Signature"), process.env.FANOUT_WEBHOOK_SECRET!);
    switch (event.event) {
      case "post.published":
      case "post.partial":
      case "post.failed":
        console.log(event.data.id, event.data.status);
        break;
      case "account.expired":
        console.log("Ask the user to reconnect", event.data.id);
        break;
    }
    res.sendStatus(200);
  } catch (err) {
    if (err instanceof FanoutError && err.code === "invalid_signature") return res.sendStatus(400);
    throw err;
  }
});
```

`verifyWebhookSignature(rawBody, header, secret, toleranceSec = 300)` returns a boolean if you only want the check. A tolerance of `0` turns off the timestamp check (not recommended).

## API reference

| Resource | Methods |
|---|---|
| `posts` | `create(input)`, `list(params)`, `iterate(params)`, `get(id)`, `delete(id)` / `cancel(id)`, `retry(id)` |
| `accounts` | `list({ profileId?, platform? })`, `get(id)`, `disconnect(id)` |
| `profiles` | `list()`, `create({ name, description? })`, `get(id)`, `update(id, { name?, description? })`, `delete(id)` |
| `connect` | `getUrl(platform, { profileId?, redirectUrl? })` |
| `platforms` | `list()` |
| `webhooks` | `list()`, `create({ url, events? })`, `delete(id)`, `test(id)` |
| `usage` | `get()` |
| `analytics` | `overview({ from?, to?, days?, profileId?, platform?, accountId?, timezone? })`, `post(id)`, `refreshPost(id)`, `account(id, { from?, to?, days? })` |

Methods return the resource itself (for example `posts.get` returns a `Post`, not `{ post }`). The full OpenAPI spec is served at `/openapi.json` on your API domain.

## Development

```bash
npm install
npm run build   # tsc to dist/
npm test        # node --test against a local mock server
```
