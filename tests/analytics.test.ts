import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { MockNet, ctx, json } from "./helpers";
import { twitterAdapter } from "../src/lib/platforms/twitter";
import { youtubeAdapter } from "../src/lib/platforms/youtube";
import { blueskyAdapter } from "../src/lib/platforms/bluesky";
import { mastodonAdapter } from "../src/lib/platforms/mastodon";
import { telegramAdapter } from "../src/lib/platforms/telegram";
import { adapters } from "../src/lib/platforms";
import { audienceOf, engagementsOf, nextMetricsAt, parseRange, rate } from "../src/lib/analytics";

let net: MockNet;
beforeEach(() => {
  net = new MockNet().install();
});
afterEach(() => net.restore());

describe("analytics math", () => {
  it("counts engagements and picks the audience", () => {
    assert.equal(engagementsOf({ likes: 10, comments: 2, shares: 3, saves: 1, quotes: 1, clicks: 50, views: 900 }), 17);
    assert.equal(engagementsOf(null), 0);
    assert.equal(audienceOf({ impressions: 1000, views: 500 }), 1000);
    assert.equal(audienceOf({ views: 500, reach: 300 }), 500);
    assert.equal(audienceOf({ likes: 1 }), null);
    assert.equal(rate(17, 1000), 0.017);
    assert.equal(rate(5, null), null);
  });

  it("backs off collection as posts age, then stops", () => {
    const now = new Date("2026-11-08T12:00:00Z");
    const ago = (h: number) => new Date(now.getTime() - h * 3600_000);
    const wait = (h: number) => (nextMetricsAt(ago(h), now)!.getTime() - now.getTime()) / 60_000;
    assert.equal(wait(1), 30);
    assert.equal(wait(24), 120);
    assert.equal(wait(24 * 3), 720);
    assert.equal(wait(24 * 20), 1440);
    assert.equal(wait(24 * 60), 7 * 1440);
    assert.equal(nextMetricsAt(ago(24 * 91), now), null);
    assert.equal(nextMetricsAt(null, now), null);
  });

  it("parses ranges", () => {
    const r = parseRange(new URLSearchParams({ from: "2026-10-01", to: "2026-10-31" }));
    assert.equal(r.from.toISOString(), "2026-10-01T00:00:00.000Z");
    assert.equal(r.to.toISOString(), "2026-10-31T23:59:59.999Z");
    const d = parseRange(new URLSearchParams({ days: "7" }));
    assert.equal(Math.round((d.to.getTime() - d.from.getTime()) / 86400_000), 7);
    const capped = parseRange(new URLSearchParams({ from: "2020-01-01", to: "2026-01-01" }));
    assert.ok(capped.to.getTime() - capped.from.getTime() <= 366 * 86400_000);
  });

  it("every adapter documents its analytics support", () => {
    for (const a of Object.values(adapters)) assert.ok(a.analytics?.note, `${a.id} has no analytics note`);
  });
});

describe("X metrics", () => {
  it("batches ids and maps public metrics", async () => {
    net.on("GET", "https://api.x.com/2/tweets?", () => ({
      data: [{ id: "1", public_metrics: { impression_count: 900, like_count: 20, reply_count: 3, retweet_count: 4, quote_count: 1, bookmark_count: 2 } }],
    }));
    const out = await twitterAdapter.analytics!.fetchPostMetrics!(ctx(), ["1", "2"]);
    const call = net.one("GET", "https://api.x.com/2/tweets?");
    assert.equal(new URL(call.url).searchParams.get("ids"), "1,2");
    assert.equal(new URL(call.url).searchParams.get("tweet.fields"), "public_metrics");
    assert.deepEqual(out, { "1": { impressions: 900, likes: 20, comments: 3, shares: 4, quotes: 1, saves: 2 } });
    assert.equal(twitterAdapter.analytics!.postBatchSize, 100);
  });
  it("reads followers", async () => {
    net.on("GET", "https://api.x.com/2/users/me?", () => ({ data: { public_metrics: { followers_count: 1200, following_count: 80, tweet_count: 450 } } }));
    assert.deepEqual(await twitterAdapter.analytics!.fetchAccountMetrics!(ctx()), { followers: 1200, following: 80, posts: 450 });
  });
});

describe("YouTube metrics", () => {
  it("reads video statistics (numbers come as strings)", async () => {
    net.on("GET", "https://www.googleapis.com/youtube/v3/videos", () => ({ items: [{ id: "v1", statistics: { viewCount: "5000", likeCount: "300", commentCount: "12" } }] }));
    const out = await youtubeAdapter.analytics!.fetchPostMetrics!(ctx(), ["v1", "gone"]);
    assert.deepEqual(out, { v1: { views: 5000, likes: 300, comments: 12 } });
    assert.match(net.one("GET", "https://www.googleapis.com/youtube/v3/videos").url, /part=statistics&id=v1%2Cgone/);
  });
  it("hides subscribers when the channel hides them", async () => {
    net.on("GET", "https://www.googleapis.com/youtube/v3/channels", () => ({ items: [{ statistics: { subscriberCount: "0", hiddenSubscriberCount: true, videoCount: "40" } }] }));
    assert.deepEqual(await youtubeAdapter.analytics!.fetchAccountMetrics!(ctx()), { followers: null, posts: 40 });
  });
});

describe("Bluesky metrics", () => {
  it("reads public counts for many uris in one call", async () => {
    net.on("GET", "https://public.api.bsky.app/xrpc/app.bsky.feed.getPosts", () => ({
      posts: [{ uri: "at://did:plc:a/app.bsky.feed.post/1", likeCount: 9, repostCount: 2, replyCount: 1, quoteCount: 0 }],
    }));
    const out = await blueskyAdapter.analytics!.fetchPostMetrics!(ctx(), ["at://did:plc:a/app.bsky.feed.post/1", "at://did:plc:a/app.bsky.feed.post/2"]);
    assert.equal(new URL(net.one("GET", "https://public.api.bsky.app/xrpc/app.bsky.feed.getPosts").url).searchParams.getAll("uris").length, 2);
    assert.deepEqual(out, { "at://did:plc:a/app.bsky.feed.post/1": { likes: 9, shares: 2, comments: 1, quotes: 0 } });
  });
  it("reads the public profile", async () => {
    net.on("GET", "https://public.api.bsky.app/xrpc/app.bsky.actor.getProfile", () => ({ followersCount: 321, followsCount: 50, postsCount: 99 }));
    const res = await blueskyAdapter.analytics!.fetchAccountMetrics!(ctx({ account: { id: "a", platformAccountId: "did:plc:a", username: "a", metadata: {} } }));
    assert.deepEqual(res, { followers: 321, following: 50, posts: 99 });
  });
});

describe("Mastodon metrics", () => {
  const creds = { instanceUrl: "https://social.test", accessToken: "tok" };
  it("reads each status and skips deleted ones", async () => {
    net.on("GET", "https://social.test/api/v1/statuses/1", () => ({ favourites_count: 7, reblogs_count: 2, replies_count: 1 }));
    net.on("GET", "https://social.test/api/v1/statuses/2", () => json({ error: "Record not found" }, 404));
    const out = await mastodonAdapter.analytics!.fetchPostMetrics!(ctx({ credentials: creds }), ["1", "2"]);
    assert.deepEqual(out, { "1": { likes: 7, shares: 2, comments: 1, quotes: null } });
  });
  it("reads followers", async () => {
    net.on("GET", "https://social.test/api/v1/accounts/verify_credentials", () => ({ followers_count: 88, following_count: 10, statuses_count: 300 }));
    assert.deepEqual(await mastodonAdapter.analytics!.fetchAccountMetrics!(ctx({ credentials: creds })), { followers: 88, following: 10, posts: 300 });
  });
});

describe("Telegram metrics", () => {
  it("reads the subscriber count only", async () => {
    net.on("POST", "https://api.telegram.org/botTOKEN/getChatMemberCount", () => ({ ok: true, result: 5400 }));
    const res = await telegramAdapter.analytics!.fetchAccountMetrics!(ctx({ credentials: { chatId: "-100", botToken: "TOKEN" } }));
    assert.deepEqual(res, { followers: 5400 });
    assert.equal(telegramAdapter.analytics!.fetchPostMetrics, undefined);
  });
});
