// Run with: npm test (builds first). Uses only node:test and fake n8n contexts; no n8n server needed.
const { test } = require("node:test");
const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const { Fanout } = require("../dist/nodes/Fanout/Fanout.node.js");
const { FanoutTrigger } = require("../dist/nodes/Fanout/FanoutTrigger.node.js");
const { FanoutApi } = require("../dist/credentials/FanoutApi.credentials.js");
const { verifySignature, PLATFORMS, WEBHOOK_EVENTS } = require("../dist/nodes/Fanout/shared.js");

const BASE = "https://api.example.com";
const SECRET = "whsec_test";

function sign(body, secret = SECRET, t = Math.floor(Date.now() / 1000)) {
  return `t=${t},v1=${crypto.createHmac("sha256", secret).update(`${t}.${body}`).digest("hex")}`;
}

/** Minimal stand-in for IExecuteFunctions / IHookFunctions / ILoadOptionsFunctions. */
function fakeContext({ params = {}, responses = [], items = 1, continueOnFail = false, staticData = {} } = {}) {
  const calls = [];
  const ctx = {
    calls,
    staticData,
    getInputData: () => Array.from({ length: items }, () => ({ json: {} })),
    getNodeParameter: (name, _i, fallback) => (name in params ? params[name] : fallback),
    getCredentials: async () => ({ apiKey: "fo_live_x", baseUrl: BASE + "/" }),
    getNode: () => ({ name: "Fanout", type: "fanout", typeVersion: 1, parameters: {} }),
    getWorkflowStaticData: () => staticData,
    getNodeWebhookUrl: () => "https://n8n.example.com/webhook/abc/webhook",
    continueOnFail: () => continueOnFail,
    helpers: {
      httpRequestWithAuthentication: async (credType, options) => {
        calls.push({ credType, ...options });
        const next = responses.shift();
        if (next instanceof Error) throw next;
        return typeof next === "function" ? next(options) : next;
      },
      returnJsonArray: (data) => (Array.isArray(data) ? data : [data]).map((json) => ({ json })),
    },
  };
  return ctx;
}

test("node descriptions are complete", () => {
  const node = new Fanout().description;
  assert.equal(node.name, "fanout");
  assert.deepEqual(node.credentials, [{ name: "fanoutApi", required: true }]);
  assert.ok(node.properties.length > 10);
  const names = new Set(node.properties.map((p) => p.name));
  for (const p of node.properties) {
    for (const key of Object.keys(p.displayOptions?.show ?? {})) assert.ok(names.has(key), `${p.name} depends on unknown parameter ${key}`);
  }
  const resources = node.properties.find((p) => p.name === "resource").options.map((o) => o.value);
  for (const r of resources) {
    assert.ok(node.properties.some((p) => p.name === "operation" && p.displayOptions.show.resource.includes(r)), `no operations for ${r}`);
  }
  assert.equal(PLATFORMS.length, 14);

  const trigger = new FanoutTrigger().description;
  assert.equal(trigger.name, "fanoutTrigger");
  assert.equal(trigger.webhooks[0].httpMethod, "POST");
  assert.deepEqual(trigger.properties.find((p) => p.name === "events").options.map((o) => o.value), WEBHOOK_EVENTS.map((e) => e.value));

  const cred = new FanoutApi();
  assert.equal(cred.name, "fanoutApi");
  assert.equal(cred.authenticate.properties.headers.Authorization, "=Bearer {{$credentials.apiKey}}");
  assert.equal(cred.test.request.url, "/api/v1/usage");
});

test("post create sends the API body shape", async () => {
  const ctx = fakeContext({
    params: {
      resource: "post",
      operation: "create",
      content: "Hello",
      targets: {
        target: [
          { accountId: "acc_1", platform: "linkedin", content: "", platformSpecificData: "{}" },
          { accountId: "acc_2", platform: "", content: "Short", platformSpecificData: '{"title":"Video"}' },
        ],
      },
      media: { item: [{ url: "https://cdn.example.com/a.jpg", type: "", altText: "A" }] },
      when: "schedule",
      scheduledFor: "2026-12-01T09:00:00",
      timezone: "Europe/Madrid",
      additionalFields: { externalId: "ext-1" },
    },
    responses: [{ post: { id: "post_1", status: "scheduled" } }],
  });
  const [out] = await new Fanout().execute.call(ctx);
  const call = ctx.calls[0];
  assert.equal(call.credType, "fanoutApi");
  assert.equal(call.method, "POST");
  assert.equal(call.url, `${BASE}/api/v1/posts`);
  assert.deepEqual(call.body, {
    content: "Hello",
    platforms: [
      { accountId: "acc_1", platform: "linkedin" },
      { accountId: "acc_2", content: "Short", platformSpecificData: { title: "Video" } },
    ],
    mediaItems: [{ url: "https://cdn.example.com/a.jpg", altText: "A" }],
    scheduledFor: "2026-12-01T09:00:00",
    timezone: "Europe/Madrid",
    externalId: "ext-1",
  });
  assert.deepEqual(out, [{ json: { id: "post_1", status: "scheduled" }, pairedItem: { item: 0 } }]);
});

test("publish now and invalid JSON options", async () => {
  const ok = fakeContext({
    params: { resource: "post", operation: "create", content: "Now", targets: { target: [{ accountId: "a" }] }, when: "now", additionalFields: {} },
    responses: [{ post: { id: "p" } }],
  });
  await new Fanout().execute.call(ok);
  assert.equal(ok.calls[0].body.publishNow, true);

  const bad = fakeContext({
    params: { resource: "post", operation: "create", targets: { target: [{ accountId: "a", platformSpecificData: "{nope" }] }, when: "now" },
    continueOnFail: true,
  });
  const [out] = await new Fanout().execute.call(bad);
  assert.match(out[0].json.error, /JSON object/);
  assert.equal(bad.calls.length, 0);
});

test("get many posts follows the cursor up to the limit", async () => {
  const ctx = fakeContext({
    params: { resource: "post", operation: "getAll", returnAll: false, limit: 3, filters: { status: "failed" } },
    responses: [
      (o) => ({ posts: [{ id: "1" }, { id: "2" }].slice(0, o.qs.limit), nextCursor: "2" }),
      (o) => ({ posts: [{ id: "3" }, { id: "4" }].slice(0, o.qs.limit), nextCursor: "4" }),
    ],
  });
  const [out] = await new Fanout().execute.call(ctx);
  assert.deepEqual(out.map((o) => o.json.id), ["1", "2", "3"]);
  assert.deepEqual(ctx.calls[0].qs, { status: "failed", limit: 3 });
  assert.deepEqual(ctx.calls[1].qs, { status: "failed", limit: 1, cursor: "2" });
});

test("accounts are split into items and connect links include query", async () => {
  const ctx = fakeContext({
    params: { resource: "account", operation: "getAll", filters: { platform: "bluesky" } },
    responses: [{ accounts: [{ id: "a1" }, { id: "a2" }] }],
  });
  const [out] = await new Fanout().execute.call(ctx);
  assert.equal(out.length, 2);
  assert.deepEqual(ctx.calls[0].qs, { platform: "bluesky" });

  const link = fakeContext({
    params: { resource: "connectLink", operation: "get", platform: "tiktok", additionalFields: { redirectUrl: "https://app.test/done" } },
    responses: [{ authUrl: "https://api.example.com/connect/tiktok?state=s", expiresInSeconds: 1800 }],
  });
  const [linkOut] = await new Fanout().execute.call(link);
  assert.equal(link.calls[0].url, `${BASE}/api/v1/connect/tiktok`);
  assert.deepEqual(link.calls[0].qs, { redirectUrl: "https://app.test/done" });
  assert.equal(linkOut[0].json.platform, "tiktok");
});

test("API errors surface the API message and per-network details", async () => {
  const apiError = Object.assign(new Error("Request failed with status code 422"), {
    response: {
      status: 422,
      data: { error: { code: "validation_error", message: "Some platforms cannot accept this post.", details: [{ platform: "instagram", errors: ["Instagram needs an image or video."] }] } },
    },
  });
  const ctx = fakeContext({
    params: { resource: "post", operation: "get", postId: "x" },
    responses: [apiError],
  });
  await assert.rejects(new Fanout().execute.call(ctx), (err) => {
    assert.match(err.message, /Some platforms cannot accept this post/);
    assert.match(err.description, /instagram: Instagram needs an image or video/);
    return true;
  });
});

test("load options list accounts", async () => {
  const ctx = fakeContext({ responses: [{ accounts: [{ id: "a1", platform: "x", displayName: "Jane", status: "active" }, { id: "a2", platform: "linkedin", username: "bob", status: "expired" }] }] });
  const options = await new Fanout().methods.loadOptions.getAccounts.call(ctx);
  assert.deepEqual(options, [
    { name: "x: Jane", value: "a1" },
    { name: "linkedin: bob (expired)", value: "a2" },
  ]);
});

test("trigger webhook lifecycle stores and clears the secret", async () => {
  const trigger = new FanoutTrigger();
  const staticData = {};
  const url = "https://n8n.example.com/webhook/abc/webhook";

  const create = fakeContext({ params: { events: ["post.failed"] }, staticData, responses: [{ webhook: { id: "wh_1", secret: SECRET } }] });
  assert.equal(await trigger.webhookMethods.default.create.call(create), true);
  assert.deepEqual(create.calls[0].body, { url, events: ["post.failed"] });
  assert.deepEqual(staticData, { webhookId: "wh_1", webhookSecret: SECRET });

  const exists = fakeContext({ params: { events: ["post.failed"] }, staticData, responses: [{ webhooks: [{ id: "wh_1", url, events: ["post.failed"] }] }] });
  assert.equal(await trigger.webhookMethods.default.checkExists.call(exists), true);

  // Events changed: the old webhook is deleted so a new one is created.
  const changed = fakeContext({ params: { events: ["post.published"] }, staticData, responses: [{ webhooks: [{ id: "wh_1", url, events: ["post.failed"] }] }, { deleted: true }] });
  assert.equal(await trigger.webhookMethods.default.checkExists.call(changed), false);
  assert.equal(changed.calls[1].method, "DELETE");
  assert.deepEqual(staticData, {});

  staticData.webhookId = "wh_2";
  staticData.webhookSecret = SECRET;
  const del = fakeContext({ staticData, responses: [new Error("404")] });
  assert.equal(await trigger.webhookMethods.default.delete.call(del), true);
  assert.deepEqual(staticData, {});
});

function webhookContext({ body, header, events = [], verify = true, raw }) {
  const sent = {};
  return {
    sent,
    getBodyData: () => body,
    getNodeParameter: (name) => (name === "events" ? events : verify),
    getWorkflowStaticData: () => ({ webhookId: "wh_1", webhookSecret: SECRET }),
    getRequestObject: () => ({ rawBody: Buffer.from(raw ?? JSON.stringify(body)) }),
    getHeaderData: () => (header ? { "x-fanout-signature": header } : {}),
    getResponseObject: () => {
      const res = {
        status(code) { sent.status = code; return res; },
        send(text) { sent.text = text; return res; },
        end() { sent.ended = true; return res; },
      };
      return res;
    },
    helpers: { returnJsonArray: (data) => [{ json: data }] },
  };
}

test("trigger accepts valid signatures and rejects bad ones", async () => {
  const trigger = new FanoutTrigger();
  const body = { id: "evt_1", event: "post.published", data: { id: "p1" } };
  const raw = JSON.stringify(body);

  const good = await trigger.webhook.call(webhookContext({ body, header: sign(raw) }));
  assert.deepEqual(good.workflowData, [[{ json: body }]]);

  const badCtx = webhookContext({ body, header: sign(raw, "whsec_wrong") });
  const bad = await trigger.webhook.call(badCtx);
  assert.equal(bad.noWebhookResponse, true);
  assert.equal(badCtx.sent.status, 401);

  const missingCtx = webhookContext({ body });
  assert.equal((await trigger.webhook.call(missingCtx)).noWebhookResponse, true);

  const filtered = await trigger.webhook.call(webhookContext({ body, header: sign(raw), events: ["post.failed"] }));
  assert.equal(filtered.workflowData, undefined);

  const testEvent = { event: "webhook.test", data: {} };
  const passed = await trigger.webhook.call(webhookContext({ body: testEvent, header: sign(JSON.stringify(testEvent)), events: ["post.failed"] }));
  assert.ok(passed.workflowData);
});

test("verifySignature positive and negative cases", () => {
  const body = '{"event":"post.failed"}';
  const now = 1_800_000_000;
  assert.equal(verifySignature(body, sign(body, SECRET, now), SECRET, 300, now), true);
  assert.equal(verifySignature(body + " ", sign(body, SECRET, now), SECRET, 300, now), false, "tampered body");
  assert.equal(verifySignature(body, sign(body, "other", now), SECRET, 300, now), false, "wrong secret");
  assert.equal(verifySignature(body, sign(body, SECRET, now - 301), SECRET, 300, now), false, "too old");
  assert.equal(verifySignature(body, undefined, SECRET), false, "missing header");
  assert.equal(verifySignature(body, "garbage", SECRET), false, "bad header");
  assert.equal(verifySignature(body, sign(body, SECRET, now), "", 300, now), false, "no secret");
});

test("analytics overview sends the range and filters, post analytics hits the post path", async () => {
  const preset = fakeContext({
    params: { resource: "analytics", operation: "getOverview", range: "7", analyticsFilters: { platform: "bluesky", timezone: "Europe/Madrid" } },
    responses: [{ totals: { posts: 2, engagements: 10 } }],
  });
  const [out] = await new Fanout().execute.call(preset);
  assert.equal(preset.calls[0].method, "GET");
  assert.equal(preset.calls[0].url, `${BASE}/api/v1/analytics`);
  assert.deepEqual(preset.calls[0].qs, { days: 7, platform: "bluesky", timezone: "Europe/Madrid" });
  assert.equal(out[0].json.totals.engagements, 10);

  const custom = fakeContext({
    params: { resource: "analytics", operation: "getOverview", range: "custom", from: "2026-10-01T00:00:00", to: "", analyticsFilters: { profileId: "prof_1" } },
    responses: [{ totals: {} }],
  });
  await new Fanout().execute.call(custom);
  assert.deepEqual(custom.calls[0].qs, { from: "2026-10-01T00:00:00", profileId: "prof_1" });

  const post = fakeContext({
    params: { resource: "analytics", operation: "getPost", analyticsPostId: "post/1" },
    responses: [{ postId: "post/1", platforms: [] }],
  });
  const [postOut] = await new Fanout().execute.call(post);
  assert.equal(post.calls[0].url, `${BASE}/api/v1/analytics/posts/post%2F1`);
  assert.equal(postOut[0].json.postId, "post/1");
});
