# Fanout

A unified social media API. Connect your users' accounts once, then publish and schedule posts to 13 networks with one request.

- **Stack:** Next.js 15 (App Router), TypeScript, Prisma, PostgreSQL, Tailwind CSS 4, Stripe.
- **Networks:** X, LinkedIn, Facebook Pages, Instagram, Threads, TikTok, YouTube, Pinterest, Reddit, Bluesky, Mastodon, Telegram, Discord.
- **Launch steps:** see [LAUNCH.md](./LAUNCH.md).

## Code map

| Path | What it does |
|---|---|
| `src/lib/platforms/*` | One adapter per network: connect (OAuth or credentials), token refresh, publish |
| `src/lib/publisher.ts` | Scheduler: claims due posts with `FOR UPDATE SKIP LOCKED`, retries, sends webhooks |
| `src/lib/posts.ts` | Post validation and creation (shared by the API and the dashboard) |
| `src/lib/accounts.ts` | Connect flow, account storage (tokens encrypted with AES-256-GCM), token refresh |
| `src/app/api/v1/*` | Public REST API (API key auth) |
| `src/app/connect/*`, `src/app/api/connect/*` | Hosted connect pages and OAuth callbacks |
| `src/app/dashboard/*` | Customer dashboard |
| `src/app/(site)/*` | Landing page, pricing, docs, legal pages |
| `src/lib/plans.ts` | Plans, prices and limits |
| `src/lib/brand.ts` | Product name and contact email |

## Run locally

```bash
cp .env.example .env   # set DATABASE_URL and APP_URL=http://localhost:3000
npm install
npx prisma migrate deploy
RUN_SCHEDULER=1 npm run dev
```

The scheduler runs inside the server when `RUN_SCHEDULER=1`. On serverless hosts call `GET /api/cron/publish` every minute with `Authorization: Bearer $CRON_SECRET`, or run `npm run worker`.
