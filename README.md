# Fanout

A unified social media API. Connect your users' accounts once, then publish and schedule posts to 14 networks with one request.

- **Stack:** Next.js 15 (App Router), TypeScript, Prisma, PostgreSQL, Tailwind CSS 4, Stripe.
- **Networks:** X, LinkedIn, Facebook Pages, Instagram, Threads, TikTok, YouTube, Pinterest, Reddit, Google Business, Bluesky, Mastodon, Telegram, Discord.
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
| `src/lib/analytics.ts` | Metrics collection schedule, overview and per-post analytics |
| `src/app/dashboard/analytics`, `src/components/charts` | Analytics dashboard and charts |
| `src/lib/mcp.ts`, `src/app/api/mcp` | Remote MCP server for AI agents |
| `src/lib/openapi.ts` | OpenAPI 3.1 spec served at `/openapi.json` |
| `sdks/node`, `sdks/python` | Client SDKs (no dependencies) |
| `integrations/n8n` | n8n community node (action + trigger) |
| `src/lib/storage.ts`, `src/lib/media.ts` | Media uploads (disk storage, type and size checks) |
| `src/lib/rate-limit.ts` | API and login rate limits |
| `src/lib/password-reset.ts`, `src/lib/email.ts` | Password reset emails (Resend) |
| `tests/` | Contract tests for every network adapter, analytics and infrastructure (`npm test`) |
| `.github/workflows/ci.yml` | CI: typecheck, tests, build, SDKs, Docker image |

## Run locally

```bash
cp .env.example .env   # set DATABASE_URL and APP_URL=http://localhost:3000
npm install
npx prisma migrate deploy
RUN_SCHEDULER=1 npm run dev
```

The scheduler runs inside the server when `RUN_SCHEDULER=1`. On serverless hosts call `GET /api/cron/publish` every minute with `Authorization: Bearer $CRON_SECRET`, or run `npm run worker`.
