import Link from "next/link";
import { brand } from "@/lib/brand";
import { plans } from "@/lib/plans";
import { platformList } from "@/lib/platforms";
import { CodeBlock, LinkButton } from "@/components/ui";
import { PlatformIcon } from "@/components/platform-icon";
import { PricingTable } from "@/components/pricing-table";

const features = [
  { title: "One request, every network", body: "Send the same post to X, LinkedIn, Instagram, TikTok, YouTube and 9 more with a single POST. Override text or options per network when you need to." },
  { title: "Hosted account connection", body: "Ask our API for a connect link, send your user there, and get an accountId back on your redirect URL. We handle OAuth, PKCE, token refresh and encryption." },
  { title: "Scheduling that keeps its promise", body: "Schedule in any IANA time zone. A queue with row-level locking, automatic retries with backoff, and clear per-network errors when a post cannot go out." },
  { title: "Webhooks for every outcome", body: "Get signed webhooks when a post is published, partly published or failed, and when a user's account is connected or needs to reconnect." },
  { title: "Analytics in the same API", body: "Views, likes, comments, shares and follower growth from every network that reports them, collected automatically and normalized into one format." },
  { title: "Profiles for each customer", body: "Group accounts by customer or brand. Perfect for agencies and SaaS products that manage many end users from one API key." },
  { title: "Bring your own developer app", body: "Plug in your own X, Meta, TikTok or Google app credentials. Your brand on the consent screen, your rate limits, your platform fees, no pass-through markup." },
];

const faqs = [
  { q: "Do I pay per connected account?", a: `No. Each plan includes a fixed number of accounts for one flat monthly price. ${plans[2].accounts} accounts cost $${plans[2].priceMonthly}/month on ${plans[2].name}.` },
  { q: "Do you charge extra for X (Twitter)?", a: "No. Connect X through your own X developer app and X bills you directly at their price. We add nothing on top." },
  { q: "Which networks need platform approval?", a: "Bluesky, Mastodon, Telegram, Discord and personal LinkedIn work right away. Meta (Facebook, Instagram, Threads), TikTok, YouTube, Pinterest and Reddit apps work for test users at once, and for the public after each network reviews your app. We tell you exactly what each one needs." },
  { q: "Can I try it without a card?", a: `Yes. The Free plan includes ${plans[0].accounts} accounts and ${plans[0].postsPerMonth} posts per month, forever.` },
  { q: "Is there an SDK?", a: "The API is plain JSON over HTTPS, so any HTTP client works. Copy the examples in the docs for curl, Node and Python." },
];

export default async function Home({ searchParams }: { searchParams: Promise<{ deleted?: string }> }) {
  const { deleted } = await searchParams;
  return (
    <>
      {deleted ? (
        <div className="border-b border-emerald-200 bg-emerald-50 px-4 py-3 text-center text-sm text-emerald-900">Your account and its data were deleted.</div>
      ) : null}
      <section className="relative overflow-hidden">
        <div className="pointer-events-none absolute inset-x-0 -top-40 -z-10 h-[500px] bg-[radial-gradient(ellipse_at_top,rgba(79,70,229,0.15),transparent_60%)]" />
        <div className="mx-auto grid max-w-6xl gap-12 px-4 pb-16 pt-16 sm:pt-24 lg:grid-cols-2 lg:items-center">
          <div>
            <span className="inline-flex items-center gap-2 rounded-full border border-line bg-white px-3 py-1 text-xs font-medium text-ink-2">
              <span className="h-1.5 w-1.5 rounded-full bg-ok" /> 14 networks · flat pricing · no per-account math
            </span>
            <h1 className="mt-5 text-4xl font-bold tracking-tight sm:text-5xl lg:text-6xl">
              The social media API that costs the same at 1 or 50 accounts.
            </h1>
            <p className="mt-5 max-w-xl text-lg text-ink-2">{brand.description}</p>
            <div className="mt-8 flex flex-wrap gap-3">
              <LinkButton href="/signup" size="lg">Get your API key free</LinkButton>
              <LinkButton href="/docs" size="lg" variant="secondary">Read the docs</LinkButton>
            </div>
            <p className="mt-3 text-sm text-muted">Free plan, no credit card. Paid plans from ${plans[1].priceMonthly}/month.</p>
          </div>
          <CodeBlock className="shadow-2xl shadow-indigo-900/20">
            <span className="c">{"// Publish to three networks at 9am New York time\n"}</span>
            {"await fetch("}<span className="s">{'"/api/v1/posts"'}</span>{", {\n  method: "}<span className="s">{'"POST"'}</span>
            {",\n  headers: { Authorization: "}<span className="s">{"`Bearer ${KEY}`"}</span>{" },\n  body: JSON.stringify({\n    "}
            <span className="k">content</span>{": "}<span className="s">{'"We just shipped dark mode 🌙"'}</span>{",\n    "}
            <span className="k">mediaItems</span>{": [{ url: "}<span className="s">{'"https://cdn.acme.dev/dark.png"'}</span>{" }],\n    "}
            <span className="k">platforms</span>{": [\n      { platform: "}<span className="s">{'"linkedin"'}</span>{", accountId: "}<span className="s">{'"acc_1"'}</span>{" },\n      { platform: "}<span className="s">{'"bluesky"'}</span>{",  accountId: "}<span className="s">{'"acc_2"'}</span>{" },\n      { platform: "}<span className="s">{'"instagram"'}</span>{", accountId: "}<span className="s">{'"acc_3"'}</span>{" },\n    ],\n    "}
            <span className="k">scheduledFor</span>{": "}<span className="s">{'"2026-12-01T09:00"'}</span>{",\n    "}
            <span className="k">timezone</span>{": "}<span className="s">{'"America/New_York"'}</span>{",\n  }),\n});"}
          </CodeBlock>
        </div>
      </section>

      <section className="border-y border-line bg-wash">
        <div className="mx-auto max-w-6xl px-4 py-10">
          <p className="text-center text-sm font-medium text-muted">Publish to</p>
          <div className="mt-5 flex flex-wrap justify-center gap-x-6 gap-y-4">
            {platformList.map((p) => (
              <div key={p.id} className="flex items-center gap-2 text-sm font-medium text-ink-2">
                <PlatformIcon platform={p.id} size={26} /> {p.name}
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="mx-auto max-w-6xl px-4 py-20">
        <h2 className="max-w-2xl text-3xl font-bold tracking-tight">Ship social posting this afternoon, not next quarter.</h2>
        <p className="mt-3 max-w-2xl text-ink-2">Every network has its own OAuth flow, media rules, token lifetimes and rate limits. We already did that work so your team does not have to.</p>
        <div className="mt-10 grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
          {features.map((f) => (
            <div key={f.title} className="rounded-2xl border border-line bg-white p-6">
              <h3 className="font-semibold">{f.title}</h3>
              <p className="mt-2 text-sm leading-relaxed text-ink-2">{f.body}</p>
            </div>
          ))}
        </div>
      </section>

      <section className="bg-ink text-white">
        <div className="mx-auto grid max-w-6xl gap-10 px-4 py-20 lg:grid-cols-2 lg:items-center">
          <div>
            <h2 className="text-3xl font-bold tracking-tight">Connect your users&apos; accounts in three steps</h2>
            <ol className="mt-6 space-y-4 text-white/80">
              <li><strong className="text-white">1.</strong> Call <code className="rounded bg-white/10 px-1">GET /api/v1/connect/instagram</code> with your redirect URL.</li>
              <li><strong className="text-white">2.</strong> Send your user to the <code className="rounded bg-white/10 px-1">authUrl</code> we return. They approve access on the network.</li>
              <li><strong className="text-white">3.</strong> We redirect back with <code className="rounded bg-white/10 px-1">accountId</code>. Store it and start posting.</li>
            </ol>
          </div>
          <CodeBlock className="ring-1 ring-white/10">{`GET /api/v1/connect/instagram?redirectUrl=https://app.acme.dev/done

{
  "authUrl": "https://${"{"}your-domain${"}"}/connect/instagram?state=...",
  "expiresInSeconds": 1800
}

→ https://app.acme.dev/done?connected=instagram&accountId=clx9...`}</CodeBlock>
        </div>
      </section>

      <section className="mx-auto max-w-6xl px-4 pt-20">
        <h2 className="text-3xl font-bold tracking-tight">Works with your stack</h2>
        <p className="mt-3 max-w-2xl text-ink-2">Use the REST API directly, or one of the ready-made integrations.</p>
        <div className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {[
            { t: "Node.js and Python SDKs", d: "Typed clients with retries, idempotency keys and webhook verification." },
            { t: "AI agents (MCP)", d: "Give Claude, Cursor or your own agent tools to post and schedule. One URL and an API key." },
            { t: "n8n", d: "Community node with actions and a trigger. Auto-post from RSS, Airtable, Notion and more." },
            { t: "OpenAPI 3.1", d: "Generate a client in any language, or import into Postman, Zapier, Make or GPT actions." },
          ].map((i) => (
            <Link key={i.t} href="/docs#sdks" className="rounded-2xl border border-line bg-white p-5 hover:border-brand">
              <h3 className="font-semibold">{i.t}</h3>
              <p className="mt-2 text-sm leading-relaxed text-ink-2">{i.d}</p>
            </Link>
          ))}
        </div>
      </section>

      <section id="pricing" className="mx-auto max-w-6xl px-4 py-20">
        <div className="text-center">
          <h2 className="text-3xl font-bold tracking-tight">Simple, flat pricing</h2>
          <p className="mt-3 text-ink-2">Every feature on every plan. Upgrade when you need more accounts.</p>
        </div>
        <div className="mt-10">
          <PricingTable />
        </div>
      </section>

      <section className="border-t border-line bg-wash">
        <div className="mx-auto max-w-3xl px-4 py-20">
          <h2 className="text-center text-3xl font-bold tracking-tight">Questions</h2>
          <div className="mt-8 divide-y divide-line rounded-2xl border border-line bg-white">
            {faqs.map((f) => (
              <details key={f.q} className="group p-5">
                <summary className="cursor-pointer list-none font-medium">{f.q}</summary>
                <p className="mt-2 text-sm leading-relaxed text-ink-2">{f.a}</p>
              </details>
            ))}
          </div>
          <div className="mt-12 text-center">
            <LinkButton href="/signup" size="lg">Create your free account</LinkButton>
            <p className="mt-3 text-sm text-muted">
              Questions about volume or migration? <Link className="text-brand" href={`mailto:${brand.supportEmail}`}>Email us</Link>.
            </p>
          </div>
        </div>
      </section>
    </>
  );
}
