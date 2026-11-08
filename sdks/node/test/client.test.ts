import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import type { AddressInfo } from "node:net";
import { Fanout, FanoutError } from "../src/index.ts";

interface Recorded {
  method: string;
  path: string;
  query: Record<string, string>;
  headers: http.IncomingHttpHeaders;
  body: unknown;
}

type Reply = { status: number; body?: unknown; headers?: Record<string, string> };

let server: http.Server;
let baseUrl = "";
const recorded: Recorded[] = [];
const queue = new Map<string, Reply[]>();

/** Queue a reply for "METHOD /path". Replies are used in order; the last one repeats. */
function reply(key: string, ...replies: Reply[]) {
  queue.set(key, replies);
}

before(async () => {
  server = http.createServer(async (req, res) => {
    const chunks: Buffer[] = [];
    for await (const c of req) chunks.push(c as Buffer);
    const raw = Buffer.concat(chunks).toString("utf8");
    const url = new URL(req.url ?? "/", "http://localhost");
    recorded.push({
      method: req.method ?? "",
      path: url.pathname,
      query: Object.fromEntries(url.searchParams),
      headers: req.headers,
      body: raw ? JSON.parse(raw) : undefined,
    });
    const key = `${req.method} ${url.pathname}`;
    const list = queue.get(key);
    const r: Reply = list && list.length > 1 ? list.shift()! : list?.[0] ?? { status: 404, body: { error: { code: "not_found", message: "no mock" } } };
    res.writeHead(r.status, { "content-type": "application/json", ...(r.headers ?? {}) });
    res.end(r.body === undefined ? "" : JSON.stringify(r.body));
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

after(() => server.close());

const last = () => recorded[recorded.length - 1];
const client = () => new Fanout({ apiKey: "fo_live_test", baseUrl, maxRetries: 2 });

const post = {
  id: "post_1",
  status: "scheduled",
  content: "hi",
  mediaItems: [],
  scheduledFor: "2026-12-01T08:00:00.000Z",
  timezone: "UTC",
  profileId: "prof_1",
  externalId: null,
  source: "api",
  publishedAt: null,
  createdAt: "2026-11-01T00:00:00.000Z",
  platforms: [],
};

test("sends auth header and appends /api/v1 to the base URL", async () => {
  reply("GET /api/v1/usage", { status: 200, body: { plan: "free", accounts: { used: 1, limit: 2 }, postsThisMonth: { used: 0, limit: 100 } } });
  const usage = await client().usage.get();
  assert.equal(usage.plan, "free");
  assert.equal(last().headers.authorization, "Bearer fo_live_test");
  assert.equal(last().path, "/api/v1/usage");
  assert.match(String(last().headers["user-agent"]), /^fanout-node\//);
});

test("does not double /api/v1 when the base URL already has it", async () => {
  reply("GET /api/v1/platforms", { status: 200, body: { platforms: [{ id: "bluesky" }] } });
  const c = new Fanout({ apiKey: "k", baseUrl: `${baseUrl}/api/v1/` });
  assert.equal(c.baseUrl, `${baseUrl}/api/v1`);
  const platforms = await c.platforms.list();
  assert.equal(platforms[0].id, "bluesky");
  assert.equal(last().path, "/api/v1/platforms");
});

test("requires an API key", () => {
  assert.throws(() => new Fanout({ apiKey: "" }), /apiKey is required/);
});

test("posts.create sends the body and unwraps the post", async () => {
  reply("POST /api/v1/posts", { status: 201, body: { post } });
  const when = new Date("2026-12-01T08:00:00.000Z");
  const result = await client().posts.create({
    content: "hi",
    platforms: [{ platform: "linkedin", accountId: "acc_1", platformSpecificData: { visibility: "PUBLIC" } }],
    mediaItems: [{ url: "https://cdn.example.com/a.png" }],
    scheduledFor: when,
    timezone: "UTC",
    externalId: "ext-1",
  });
  assert.equal(result.id, "post_1");
  assert.equal(last().method, "POST");
  assert.equal(last().headers["content-type"], "application/json");
  assert.deepEqual(last().body, {
    content: "hi",
    platforms: [{ platform: "linkedin", accountId: "acc_1", platformSpecificData: { visibility: "PUBLIC" } }],
    mediaItems: [{ url: "https://cdn.example.com/a.png" }],
    scheduledFor: "2026-12-01T08:00:00.000Z",
    timezone: "UTC",
    externalId: "ext-1",
  });
});

test("posts.list passes query params and skips empty ones", async () => {
  reply("GET /api/v1/posts", { status: 200, body: { posts: [post], nextCursor: null } });
  const page = await client().posts.list({ limit: 5, status: "failed", profileId: undefined });
  assert.equal(page.posts.length, 1);
  assert.deepEqual(last().query, { limit: "5", status: "failed" });
});

test("posts.iterate follows nextCursor", async () => {
  reply(
    "GET /api/v1/posts",
    { status: 200, body: { posts: [{ ...post, id: "a" }, { ...post, id: "b" }], nextCursor: "b" } },
    { status: 200, body: { posts: [{ ...post, id: "c" }], nextCursor: null } },
  );
  const ids: string[] = [];
  for await (const p of client().posts.iterate({ limit: 2 })) ids.push(p.id);
  assert.deepEqual(ids, ["a", "b", "c"]);
  assert.deepEqual(last().query, { limit: "2", cursor: "b" });
});

test("posts.get, delete, cancel and retry", async () => {
  reply("GET /api/v1/posts/post%2F1", { status: 200, body: { post } });
  reply("DELETE /api/v1/posts/post_1", { status: 200, body: { deleted: false, cancelled: true } });
  reply("POST /api/v1/posts/post_1/retry", { status: 200, body: { requeued: 2 } });
  const c = client();
  assert.equal((await c.posts.get("post/1")).id, "post_1");
  assert.equal(last().path, "/api/v1/posts/post%2F1");
  assert.deepEqual(await c.posts.delete("post_1"), { deleted: false, cancelled: true });
  assert.equal(last().method, "DELETE");
  assert.deepEqual(await c.posts.cancel("post_1"), { deleted: false, cancelled: true });
  assert.deepEqual(await c.posts.retry("post_1"), { requeued: 2 });
  assert.equal(last().method, "POST");
  assert.equal(last().body, undefined);
});

test("accounts resource", async () => {
  reply("GET /api/v1/accounts", { status: 200, body: { accounts: [{ id: "acc_1" }] } });
  reply("GET /api/v1/accounts/acc_1", { status: 200, body: { account: { id: "acc_1" } } });
  reply("DELETE /api/v1/accounts/acc_1", { status: 200, body: { deleted: true } });
  const c = client();
  assert.equal((await c.accounts.list({ platform: "bluesky", profileId: "p1" }))[0].id, "acc_1");
  assert.deepEqual(last().query, { platform: "bluesky", profileId: "p1" });
  assert.equal((await c.accounts.get("acc_1")).id, "acc_1");
  assert.deepEqual(await c.accounts.disconnect("acc_1"), { deleted: true });
  assert.equal(last().method, "DELETE");
});

test("profiles resource", async () => {
  reply("GET /api/v1/profiles", { status: 200, body: { profiles: [{ id: "p1", name: "Default" }] } });
  reply("POST /api/v1/profiles", { status: 201, body: { profile: { id: "p2", name: "Client" } } });
  reply("GET /api/v1/profiles/p2", { status: 200, body: { profile: { id: "p2", name: "Client" } } });
  reply("PATCH /api/v1/profiles/p2", { status: 200, body: { profile: { id: "p2", name: "Renamed" } } });
  reply("DELETE /api/v1/profiles/p2", { status: 200, body: { deleted: true } });
  const c = client();
  assert.equal((await c.profiles.list())[0].id, "p1");
  assert.equal((await c.profiles.create({ name: "Client", description: "VIP" })).id, "p2");
  assert.deepEqual(last().body, { name: "Client", description: "VIP" });
  assert.equal((await c.profiles.get("p2")).name, "Client");
  assert.equal((await c.profiles.update("p2", { name: "Renamed", description: null })).name, "Renamed");
  assert.equal(last().method, "PATCH");
  assert.deepEqual(last().body, { name: "Renamed", description: null });
  assert.deepEqual(await c.profiles.delete("p2"), { deleted: true });
});

test("connect.getUrl", async () => {
  reply("GET /api/v1/connect/instagram", { status: 200, body: { authUrl: "https://x/connect/instagram?state=s", expiresInSeconds: 1800 } });
  const r = await client().connect.getUrl("instagram", { profileId: "p1", redirectUrl: "https://app.example.com/done?x=1" });
  assert.equal(r.expiresInSeconds, 1800);
  assert.deepEqual(last().query, { profileId: "p1", redirectUrl: "https://app.example.com/done?x=1" });
});

test("webhooks resource", async () => {
  reply("GET /api/v1/webhooks", { status: 200, body: { webhooks: [] } });
  reply("POST /api/v1/webhooks", { status: 201, body: { webhook: { id: "wh_1", secret: "whsec_x" } } });
  reply("DELETE /api/v1/webhooks/wh_1", { status: 200, body: { deleted: true } });
  reply("POST /api/v1/webhooks/wh_1/test", { status: 200, body: { delivered: true, status: 200, error: null } });
  const c = client();
  assert.deepEqual(await c.webhooks.list(), []);
  const hook = await c.webhooks.create({ url: "https://app.example.com/hook", events: ["post.published"] });
  assert.equal(hook.secret, "whsec_x");
  assert.deepEqual(last().body, { url: "https://app.example.com/hook", events: ["post.published"] });
  assert.deepEqual(await c.webhooks.test("wh_1"), { delivered: true, status: 200, error: null });
  assert.deepEqual(await c.webhooks.delete("wh_1"), { deleted: true });
});

test("API errors become FanoutError with code and details", async () => {
  const details = [{ accountId: "acc_1", platform: "twitter", errors: ["X posts are limited to 280 characters."] }];
  reply("POST /api/v1/posts", { status: 422, body: { error: { code: "validation_error", message: "Some platforms cannot accept this post.", details } } });
  await assert.rejects(
    client().posts.create({ content: "x".repeat(300), platforms: [{ accountId: "acc_1" }] }),
    (err: unknown) => {
      assert.ok(err instanceof FanoutError);
      assert.equal(err.status, 422);
      assert.equal(err.code, "validation_error");
      assert.deepEqual(err.details, details);
      return true;
    },
  );
});

test("GET retries on 503 then succeeds", async () => {
  const before = recorded.length;
  reply(
    "GET /api/v1/accounts",
    { status: 503, body: { error: { code: "internal_error", message: "busy" } }, headers: { "retry-after": "0" } },
    { status: 200, body: { accounts: [] } },
  );
  assert.deepEqual(await client().accounts.list(), []);
  assert.equal(recorded.length - before, 2);
});

test("GET gives up after maxRetries", async () => {
  const before = recorded.length;
  reply("GET /api/v1/profiles", { status: 500, body: { error: { code: "internal_error", message: "down" } }, headers: { "retry-after": "0" } });
  await assert.rejects(client().profiles.list(), (err: unknown) => err instanceof FanoutError && err.status === 500 && err.code === "internal_error");
  assert.equal(recorded.length - before, 3);
});

test("POST is never retried", async () => {
  const before = recorded.length;
  reply("POST /api/v1/posts", { status: 503, body: { error: { code: "internal_error", message: "busy" } }, headers: { "retry-after": "0" } });
  await assert.rejects(client().posts.create({ platforms: [{ accountId: "a" }] }), FanoutError);
  assert.equal(recorded.length - before, 1);
});

test("network errors become FanoutError with status 0", async () => {
  const c = new Fanout({ apiKey: "k", baseUrl: "http://127.0.0.1:1", maxRetries: 0 });
  await assert.rejects(c.usage.get(), (err: unknown) => err instanceof FanoutError && err.status === 0 && err.code === "network_error");
});

test("non-JSON error bodies still produce a useful error", async () => {
  reply("GET /api/v1/posts/broken", { status: 502, body: undefined });
  const c = new Fanout({ apiKey: "k", baseUrl, maxRetries: 0 });
  await assert.rejects(c.posts.get("broken"), (err: unknown) => err instanceof FanoutError && err.status === 502 && err.message === "HTTP 502");
});
