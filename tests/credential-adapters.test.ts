import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { MockNet, ctx, json } from "./helpers";
import { PlatformError } from "../src/lib/platforms/http";
import { blueskyAdapter } from "../src/lib/platforms/bluesky";
import { mastodonAdapter } from "../src/lib/platforms/mastodon";
import { telegramAdapter } from "../src/lib/platforms/telegram";
import { discordAdapter } from "../src/lib/platforms/discord";
import { adapters } from "../src/lib/platforms";
import { PLATFORM_IDS } from "../src/lib/platforms/types";

let net: MockNet;
beforeEach(() => {
  net = new MockNet().media().install();
});
afterEach(() => net.restore());

async function rejects(p: Promise<unknown>, check: (e: PlatformError) => void) {
  try {
    await p;
  } catch (err) {
    assert.ok(err instanceof PlatformError, `expected PlatformError, got ${err}`);
    check(err);
    return;
  }
  assert.fail("expected the promise to reject");
}

describe("registry", () => {
  it("has one adapter per platform id with matching ids", () => {
    assert.deepEqual(Object.keys(adapters).sort(), [...PLATFORM_IDS].sort());
    for (const [id, a] of Object.entries(adapters)) assert.equal(a.id, id);
  });
  it("builds https authorize URLs that carry the state", () => {
    for (const a of Object.values(adapters)) {
      if (a.kind !== "oauth") continue;
      const url = new URL(a.getAuthUrl({ app: { clientId: "id", clientSecret: "s" }, redirectUri: "https://app.test/cb", state: "STATE123", codeChallenge: "c" }));
      assert.equal(url.protocol, "https:", a.id);
      assert.equal(url.searchParams.get("state"), "STATE123", a.id);
      assert.equal(url.searchParams.get("redirect_uri"), "https://app.test/cb", a.id);
    }
  });
});

describe("Bluesky", () => {
  const S = "https://bsky.social/xrpc";
  const session = { accessJwt: "JWT", did: "did:plc:abc", handle: "jane.bsky.social" };

  it("verifies an app password and stores credentials", async () => {
    net.on("POST", `${S}/com.atproto.server.createSession`, () => session);
    net.on("GET", `${S}/app.bsky.actor.getProfile`, () => ({ displayName: "Jane", avatar: "https://cdn/av.jpg" }));
    const { identity, credentials } = await blueskyAdapter.verify({ handle: "@jane.bsky.social", appPassword: "aaaa-bbbb-cccc-dddd", service: "" });
    assert.equal(identity.platformAccountId, "did:plc:abc");
    assert.equal(identity.displayName, "Jane");
    assert.deepEqual(credentials, { identifier: "jane.bsky.social", password: "aaaa-bbbb-cccc-dddd", service: "https://bsky.social" });
  });

  it("builds UTF-8 byte facets for links, tags and mentions, and embeds images", async () => {
    net.on("POST", `${S}/com.atproto.server.createSession`, () => session);
    net.on("GET", `${S}/com.atproto.identity.resolveHandle`, () => ({ did: "did:plc:bob" }));
    net.on("POST", `${S}/com.atproto.repo.uploadBlob`, () => ({ blob: { $type: "blob", ref: { $link: "bafy" }, mimeType: "image/jpeg", size: 2048 } }));
    net.on("POST", `${S}/com.atproto.repo.createRecord`, () => ({ uri: "at://did:plc:abc/app.bsky.feed.post/3kxyz", cid: "c" }));
    const text = "🚀 Launch https://example.com/x. #ship with @bob.bsky.social";
    const res = await blueskyAdapter.publish(
      ctx({ credentials: { identifier: "jane.bsky.social", password: "p", service: "https://bsky.social" }, content: text, media: [{ type: "image", url: "https://media.test/photo.jpg", altText: "alt" }] }),
    );
    const record = net.one("POST", `${S}/com.atproto.repo.createRecord`).json.record;
    const bytes = Buffer.from(text, "utf8");
    const slice = (f: any) => bytes.subarray(f.index.byteStart, f.index.byteEnd).toString("utf8");
    const link = record.facets.find((f: any) => f.features[0].$type.endsWith("#link"));
    const tag = record.facets.find((f: any) => f.features[0].$type.endsWith("#tag"));
    const mention = record.facets.find((f: any) => f.features[0].$type.endsWith("#mention"));
    assert.equal(slice(link), "https://example.com/x");
    assert.equal(link.features[0].uri, "https://example.com/x");
    assert.equal(slice(tag), "#ship");
    assert.equal(slice(mention), "@bob.bsky.social");
    assert.equal(mention.features[0].did, "did:plc:bob");
    assert.equal(record.embed.images[0].alt, "alt");
    assert.equal(res.url, "https://bsky.app/profile/jane.bsky.social/post/3kxyz");
  });

  it("rejects images over 1 MB and bad passwords", async () => {
    net.on("POST", `${S}/com.atproto.server.createSession`, () => session, 1);
    await rejects(
      blueskyAdapter.publish(ctx({ credentials: { identifier: "j", password: "p", service: "https://bsky.social" }, media: [{ type: "image", url: "https://media.test/big.jpg" }] })),
      (e) => assert.match(e.message, /1 MB/),
    );
    net.on("POST", `${S}/com.atproto.server.createSession`, () => json({ error: "AuthenticationRequired" }, 401));
    await rejects(blueskyAdapter.publish(ctx({ credentials: { identifier: "j", password: "bad", service: "https://bsky.social" } })), (e) => assert.equal(e.opts.auth, true));
  });

  it("counts graphemes, not code units", () => {
    assert.equal(blueskyAdapter.validate!({ content: "👍".repeat(300), media: [], options: {} }).length, 0);
    assert.ok(blueskyAdapter.validate!({ content: "a".repeat(301), media: [], options: {} }).length > 0);
  });
});

describe("Mastodon", () => {
  const I = "https://social.test";
  it("verifies, uploads media, waits for processing and posts", async () => {
    net.on("GET", `${I}/api/v1/accounts/verify_credentials`, () => ({ id: "9", username: "jane", display_name: "Jane", avatar: "https://a", url: "https://social.test/@jane" }));
    const { identity } = await mastodonAdapter.verify({ instanceUrl: "social.test", accessToken: "tok" });
    assert.equal(identity.platformAccountId, "social.test:9");
    assert.equal(identity.username, "jane@social.test");

    net.on("POST", `${I}/api/v2/media`, () => json({ id: "m1", url: null }, 202));
    net.on("GET", `${I}/api/v1/media/m1`, () => ({ id: "m1", url: "https://social.test/m1.jpg" }));
    net.on("POST", `${I}/api/v1/statuses`, () => ({ id: "s1", url: "https://social.test/@jane/s1" }));
    const res = await mastodonAdapter.publish(
      ctx({ credentials: { instanceUrl: I, accessToken: "tok" }, media: [{ type: "image", url: "https://media.test/photo.jpg" }], options: { visibility: "unlisted", spoilerText: "cw" } }),
    );
    const status = net.one("POST", `${I}/api/v1/statuses`);
    assert.deepEqual(status.json.media_ids, ["m1"]);
    assert.equal(status.json.visibility, "unlisted");
    assert.equal(status.json.spoiler_text, "cw");
    assert.ok(status.headers["idempotency-key"]);
    assert.equal(res.url, "https://social.test/@jane/s1");
  });
});

describe("Telegram", () => {
  const B = "https://api.telegram.org/botTOKEN";
  it("verifies the bot is in the channel", async () => {
    net.on("POST", `${B}/getMe`, () => ({ ok: true, result: { id: 1, username: "fan_bot" } }));
    net.on("POST", `${B}/getChat`, () => ({ ok: true, result: { id: -1001234, title: "News", username: "news", type: "channel" } }));
    net.on("POST", `${B}/getChatMember`, () => ({ ok: true, result: { status: "administrator" } }));
    const { identity, credentials } = await telegramAdapter.verify({ botToken: "TOKEN", chatId: "@news" });
    assert.equal(identity.platformAccountId, "-1001234");
    assert.deepEqual(credentials, { chatId: "-1001234", botToken: "TOKEN" });
  });

  it("sends long captions as a separate message and builds links", async () => {
    net.on("POST", `${B}/sendPhoto`, () => ({ ok: true, result: { message_id: 5 } }));
    net.on("POST", `${B}/sendMessage`, () => ({ ok: true, result: { message_id: 6 } }));
    const long = "x".repeat(1500);
    const res = await telegramAdapter.publish(
      ctx({ account: { id: "a", platformAccountId: "-1001234", username: "news", metadata: {} }, credentials: { chatId: "-1001234", botToken: "TOKEN" }, content: long, media: [{ type: "image", url: "https://media.test/photo.jpg" }] }),
    );
    assert.equal(net.one("POST", `${B}/sendPhoto`).json.caption, undefined);
    assert.equal(net.one("POST", `${B}/sendMessage`).json.text, long);
    assert.equal(res.url, "https://t.me/news/5");
  });

  it("uses media groups and private channel links", async () => {
    net.on("POST", `${B}/sendMediaGroup`, () => ({ ok: true, result: [{ message_id: 8 }, { message_id: 9 }] }));
    const res = await telegramAdapter.publish(
      ctx({
        account: { id: "a", platformAccountId: "-1009876", username: null, metadata: {} },
        credentials: { chatId: "-1009876", botToken: "TOKEN" },
        media: [
          { type: "image", url: "https://media.test/photo.jpg" },
          { type: "video", url: "https://media.test/clip.mp4" },
        ],
      }),
    );
    const media = net.one("POST", `${B}/sendMediaGroup`).json.media;
    assert.equal(media[0].caption, "Hello world");
    assert.equal(media[1].type, "video");
    assert.equal(res.url, "https://t.me/c/9876/8");
  });

  it("surfaces Telegram's error description", async () => {
    net.on("POST", `${B}/sendMessage`, () => json({ ok: false, description: "Bad Request: chat not found" }, 400));
    await rejects(telegramAdapter.publish(ctx({ credentials: { chatId: "1", botToken: "TOKEN" } })), (e) => assert.match(e.message, /chat not found/));
  });
});

describe("Discord", () => {
  const W = "https://discord.com/api/webhooks/123/abc-DEF";
  it("only accepts Discord webhook URLs", async () => {
    await rejects(discordAdapter.verify({ webhookUrl: "https://evil.test/api/webhooks/1/x" }), (e) => assert.match(e.message, /not a Discord webhook/));
  });
  it("posts embeds and maps deleted webhooks to auth errors", async () => {
    net.on("GET", W, () => ({ id: "123", name: "Bot", channel_id: "c1", guild_id: "g1" }));
    const { identity, credentials } = await discordAdapter.verify({ webhookUrl: W });
    assert.equal(identity.metadata!.guildId, "g1");
    net.on("POST", `${W}?wait=true`, () => ({ id: "m1", channel_id: "c1" }), 1);
    const res = await discordAdapter.publish(
      ctx({ account: { id: "a", platformAccountId: "123", username: null, metadata: identity.metadata! }, credentials, media: [{ type: "image", url: "https://media.test/photo.jpg" }, { type: "video", url: "https://media.test/clip.mp4" }] }),
    );
    const body = net.one("POST", `${W}?wait=true`).json;
    assert.equal(body.embeds[0].image.url, "https://media.test/photo.jpg");
    assert.match(body.content, /clip\.mp4/);
    assert.deepEqual(body.allowed_mentions, { parse: [] });
    assert.equal(res.url, "https://discord.com/channels/g1/c1/m1");
    net.on("POST", `${W}?wait=true`, () => json({ message: "Unknown Webhook" }, 404));
    await rejects(discordAdapter.publish(ctx({ credentials })), (e) => assert.equal(e.opts.auth, true));
  });
});
