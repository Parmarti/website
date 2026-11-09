# Launch guide: paying users in 48 hours

This file tells you what is built, how to deploy it, and how to get the first paying customers.
"Fanout" is a placeholder name. Change it in `src/lib/brand.ts` (one file).

---

## 1. What the competitor sells (research summary)

Zernio (previously "Late", getlate.dev) is a unified social media API for developers, agencies and AI agent builders.

- **Core product:** one REST call (`POST /v1/posts`) publishes or schedules a post to about 15 networks. Developers connect their end users' accounts with OAuth and get an `accountId` back.
- **What customers pay for:** connected social accounts. First 2 accounts free, then $6, $3 and $1 per account per month at higher volumes. X (Twitter) usage is billed on top.
- **Add-on modules:** analytics, inbox (comments and DMs), ads, WhatsApp.
- **Weak points in public reviews:** posts that sometimes do not go out, per-account pricing that is hard to predict, extra fees for X.

**Our position:** the same core API with flat pricing, no X markup (customers bring their own X app), and clear per-network errors.

| Connected accounts | Per-account model (2026 public rates) | Fanout |
|---|---|---|
| 10 | $48 / month | $9 (Starter) |
| 50 | $168 / month | $29 (Growth) |
| 250 | $468 / month | $99 (Scale) |

Check the competitor's current prices before you publish any comparison. Do not use their name or logo on your site without legal advice.

---

## 2. What is built

| Area | Status |
|---|---|
| REST API v1: posts, accounts, profiles, connect, platforms, webhooks, usage | Done, tested |
| Hosted connect flow (OAuth with PKCE, and credential forms) | Done, tested |
| Scheduler: time zones, row locking, retries (1, 5, 15 min), stuck-job recovery, token refresh | Done, tested |
| Signed webhooks (HMAC SHA-256) | Done, tested |
| Dashboard: API keys, accounts, profiles, composer, post history, webhooks, own developer apps, billing | Done, tested |
| Stripe Checkout, customer portal, subscription webhooks, plan limits | Done, needs your Stripe keys |
| Landing page, pricing, API docs, terms and privacy templates | Done |
| Account picker when one login returns many Pages or locations (respects plan limits) | Done, tested |
| `Idempotency-Key` on post creation (safe retries, no duplicate posts) | Done, tested |
| Remote MCP server for AI agents (`/api/mcp`, 10 tools) | Done, tested with the official MCP client |
| OpenAPI 3.1 spec (`/openapi.json`) | Done, validated |
| Node.js and Python SDKs (`sdks/`) | Done, 25 + 23 tests pass |
| n8n community node with trigger (`integrations/n8n`) | Done, 10 tests pass, not yet tried in a live n8n |
| Analytics: post metrics, follower growth, dashboard, API, MCP and SDK support | Done, tested (see below) |
| Contract tests for all network adapters and metrics collectors (`npm test`) | 80 tests pass |
| 14 networks: X, LinkedIn, Facebook Pages, Instagram, Threads, TikTok, YouTube, Pinterest, Reddit, Google Business, Bluesky, Mastodon, Telegram, Discord | Code done; see note below |

**Important:** this sandbox cannot reach the real social networks. The full publish flow was tested end to end against a local mock server (44 automated checks pass). Each network's real API must be tested once with a real account after you deploy. Start with the "works today" networks in section 4.

**Analytics coverage:** post metrics from X, Facebook, Instagram, Threads, TikTok, YouTube, Pinterest, Reddit, Bluesky and Mastodon; follower counts from those plus Telegram. LinkedIn (needs Community Management API approval), Discord and Google Business do not report post metrics. Analytics added new permissions to the Meta, TikTok and Reddit apps (`read_insights`, `instagram_business_manage_insights`, `threads_manage_insights`, `video.list`, `user.info.stats`, `read`): include them in your app reviews. Accounts connected before this change must reconnect to get views and reach.

To demo the dashboard with sample data on a local or staging database: `npx tsx scripts/dev-seed-analytics.ts you@example.com`.

**Also built before launch:** API rate limits (300 requests and 60 writes per minute per account, 10 login tries per 15 minutes), password reset by email, account settings with self-serve deletion, media uploads (stored on a Railway volume, served at `/media/...`), and a GitHub Actions workflow that runs the typecheck, all tests, the build and a Docker image build on every push.

**Not built yet (roadmap, sell as "coming soon"):** inbox (comments and DMs), ads, WhatsApp, Snapchat, team members.

---

## 3. Deploy (about 30 minutes)

### Option A: Railway (recommended, one service runs everything)

1. Push this repository to GitHub (already done on branch `claude/optimistic-galileo-4utaoz`; merge it into `master`).
2. On railway.com: **New project > Deploy from GitHub repo**. Railway finds the `Dockerfile`.
3. Add a **PostgreSQL** database to the project. Railway sets `DATABASE_URL`.
4. Set the variables from `.env.example`. Minimum:
   - `APP_URL` = your public URL, for example `https://api.yourdomain.com`
   - `ENCRYPTION_KEY` = output of `openssl rand -hex 32` (**back it up; if you lose it, every connected account must reconnect**)
   - `CRON_SECRET` = output of `openssl rand -hex 24`
   - `RUN_SCHEDULER=1`
   - `SUPPORT_EMAIL`
   - `MEDIA_DIR=/data/uploads`, and add a **Volume** to the service mounted at `/data` (uploaded media is stored there)
   - `RESEND_API_KEY` and `EMAIL_FROM` for password reset emails (resend.com: add and verify your domain, then create an API key). Without them, reset links are only written to the server log.
5. Add your domain in Railway and point DNS to it.
6. Open `https://yourdomain/api/health`. It must return `{"ok":true}`.

The container runs database migrations on start (`npm run start:prod`).

### Option B: Vercel + Neon

Works, but the scheduler needs a cron every minute. `vercel.json` has it, but per-minute cron needs a paid Vercel plan. On the free plan use cron-job.org to call `GET https://yourdomain/api/cron/publish` every minute with header `Authorization: Bearer <CRON_SECRET>`. Run `npx prisma migrate deploy` once against the database. Do not set `RUN_SCHEDULER`.

---

## 4. Social network apps (do these in this order)

Redirect URI for every OAuth network: `{APP_URL}/api/connect/{platform}/callback`
(for example `https://api.yourdomain.com/api/connect/linkedin/callback`).

**Work today, no approval:**

1. **Bluesky, Mastodon, Telegram, Discord:** no app needed. Users connect with an app password, token, bot or webhook. Optional: create one Telegram bot with @BotFather and set `TELEGRAM_BOT_TOKEN`, so users only add your bot to their channel.
2. **LinkedIn (personal profiles):** developer.linkedin.com > Create app > Products: add "Sign In with LinkedIn using OpenID Connect" and "Share on LinkedIn" (instant). Set `LINKEDIN_CLIENT_ID` / `LINKEDIN_CLIENT_SECRET`. Company pages need "Community Management API" approval (apply now, it takes time).

**Work for test users today, public use after review (apply on day 1):**

3. **X:** developer.x.com > Project > App > User authentication settings: OAuth 2.0, type "Web App", callback URL as above. Posting needs a paid API plan or pay-per-use credit. Tell customers to use their own X app in **Developer apps** so X bills them directly.
4. **Meta (Facebook, Instagram, Threads):** developers.facebook.com > Create app (Business). Add Facebook Login, the "Instagram API with Instagram login" product and the Threads API. In development mode, people you add as app testers can connect at once. For the public, submit App Review for `pages_manage_posts`, `instagram_business_content_publish` and `threads_content_publish` (needs the privacy policy URL `/legal/privacy`, a screencast, and business verification). Set `FACEBOOK_*`, `INSTAGRAM_*` (Instagram app ID is different from the Facebook app ID), `THREADS_*`.
5. **TikTok:** developers.tiktok.com > app with Login Kit + Content Posting API (scopes `user.info.basic`, `video.publish`, `video.upload`). Until TikTok audits the app, posts are private (SELF_ONLY). Submit the audit on day 1.
6. **YouTube:** Google Cloud > enable YouTube Data API v3 > OAuth consent screen > Web client. Unverified apps: 100 test users, and uploads stay private until Google approves an API audit.
7. **Google Business Profile:** same Google Cloud project as YouTube. Enable "My Business Account Management API", "My Business Business Information API" and the Google My Business API, then request API access with Google's form (quota is 0 until approved). Set `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` to share one client with YouTube. Agencies with many locations pick which ones to connect.
8. **Pinterest:** developers.pinterest.com > app. Trial access works at once with limits; request standard access.
9. **Reddit:** reddit.com/prefs/apps > "web app". Set `REDDIT_USER_AGENT`. Commercial use needs Reddit's approval.

Customers who already have their own approved apps can paste them in **Dashboard > Developer apps** and skip your approval wait. This is a strong selling point for agencies and SaaS teams: say it in every conversation.

---

## 5. Stripe (20 minutes)

1. Stripe Dashboard > Product catalog: create "Starter" ($9/month), "Growth" ($29/month), "Scale" ($99/month), all recurring monthly. Copy each **price ID** to `STRIPE_PRICE_STARTER`, `STRIPE_PRICE_GROWTH`, `STRIPE_PRICE_SCALE`.
2. Developers > API keys: set `STRIPE_SECRET_KEY` (live key once the LLC and bank account are verified; test key until then).
3. Developers > Webhooks > Add endpoint `https://yourdomain/api/stripe/webhook` with events `checkout.session.completed`, `customer.subscription.created`, `customer.subscription.updated`, `customer.subscription.deleted`. Set `STRIPE_WEBHOOK_SECRET`.
4. Settings > Billing > Customer portal: turn it on and allow plan changes and cancellation between the three prices.
5. Products > Coupons: create a launch coupon, for example 50% off for 3 months, with promotion code `FOUNDER50`. Checkout accepts promotion codes.
6. Test: sign up, upgrade with card 4242 4242 4242 4242, confirm the plan badge changes.

Prices and limits live in `src/lib/plans.ts`.

---

## 6. Publish the integrations (1 to 2 hours, big distribution boost)

Change the placeholder names first (`@fanout/node`, `fanout`, `n8n-nodes-fanout`, and the `https://api.example.com` default URL in each SDK).

- **Node SDK:** `cd sdks/node && npm run build && npm publish --access public`
- **Python SDK:** `cd sdks/python && python3 -m build && twine upload dist/*`
- **n8n node:** `cd integrations/n8n && npm run build && npm publish`. Then submit it for n8n's verified community nodes. n8n users search the node list, so this is free discovery.
- **MCP server:** add it to the public MCP registries and directories (the official MCP registry, Smithery, mcp.so, PulseMCP). AI agent builders look there first. Server URL: `{APP_URL}/api/mcp`, auth: `Authorization: Bearer <API key>`.
- **OpenAPI:** `{APP_URL}/openapi.json` works for Postman collections, custom GPT actions and Zapier/Make HTTP steps.

## 7. Get the first paying users (48 hour plan)

**Who buys this now:** developers building AI agents, n8n/Make/Zapier automation builders, indie SaaS founders who need "share to social" features, and small agencies that manage 10 to 50 client accounts.

**Day 1 (after deploy):**

- Post on X and LinkedIn from the product itself: "I built a social media API with flat pricing. 14 networks, $9 for 10 accounts." Include a 30 second screen recording of one curl call posting to 3 networks.
- Show HN: "Show HN: A flat-priced unified social media posting API". Be in the thread for the first 3 hours.
- Post in r/SaaS, r/n8n, r/automation, r/webdev (follow each subreddit's self-promotion rules), Indie Hackers, and the n8n community forum with a working n8n HTTP Request example.
- Direct messages: search X, Reddit and Indie Hackers for people asking "social media API", "schedule posts API", "post to Instagram and TikTok with one API", or complaining about per-account pricing. Offer the `FOUNDER50` code and free migration help. Aim for 50 personal messages.

**Day 2:**

- Write two SEO pages: "Social media posting API pricing compared" and "How to post to Instagram, TikTok and LinkedIn with one API call" (link to the docs).
- Publish a minimal n8n workflow and a Make scenario template that call `POST /api/v1/posts`.
- Follow up on every sign-up by email within 1 hour. Ask what they are building and what network they need first. The dashboard shows sign-ups in the `User` table.
- Offer a "done-for-you" setup call for the Growth plan. Early customers pay for hand-holding.

**What to say to an agency:** "Connect all your clients' accounts with your own Meta/TikTok/X apps, keep each client in its own profile, and pay $29 a month for 50 accounts instead of per account."

---

## 8. Before you take money

- [ ] Change the name in `src/lib/brand.ts` and check that the domain and trademark are free.
- [ ] Have a lawyer review `/legal/terms` and `/legal/privacy` (replace `[COMPANY]` and `[JURISDICTION]`).
- [ ] Back up `ENCRYPTION_KEY` in a password manager.
- [ ] Post one real message to each network you advertise, from the deployed app.
- [ ] Turn on database backups in your host.
- [ ] Set up an email inbox for `SUPPORT_EMAIL`.

## 9. Local development

```bash
cp .env.example .env      # set DATABASE_URL and APP_URL=http://localhost:3000
npm install
npx prisma migrate deploy
RUN_SCHEDULER=1 npm run dev
npm test                  # adapter contract tests
```
