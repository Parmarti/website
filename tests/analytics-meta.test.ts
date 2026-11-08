import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { MockNet, ctx, json } from "./helpers";
import { PlatformError } from "../src/lib/platforms/http";
import { facebookAdapter } from "../src/lib/platforms/facebook";
import { instagramAdapter } from "../src/lib/platforms/instagram";
import { threadsAdapter } from "../src/lib/platforms/threads";
import { tiktokAdapter } from "../src/lib/platforms/tiktok";
import { pinterestAdapter } from "../src/lib/platforms/pinterest";
import { redditAdapter } from "../src/lib/platforms/reddit";
import type { OAuthAdapter, PublishContext } from "../src/lib/platforms/types";

let net: MockNet;
beforeEach(() => {
  net = new MockNet().install();
});
afterEach(() => net.restore());

const acct = (platformAccountId: string, username: string | null = null) => ({ id: "a", platformAccountId, username, metadata: {} });
const posts = (a: OAuthAdapter, c: PublishContext, ids: string[]) => a.analytics!.fetchPostMetrics!(c, ids);
const account = (a: OAuthAdapter, c: PublishContext) => a.analytics!.fetchAccountMetrics!(c);
const scopeOf = (a: OAuthAdapter) =>
  new URL(a.getAuthUrl({ app: { clientId: "id", clientSecret: "s" }, redirectUri: "https://app.test/cb", state: "s", codeChallenge: "c" })).searchParams.get("scope") ?? "";

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

describe("Facebook analytics", () => {
  const G = "https://graph.facebook.com/v23.0";

  it("asks for read_insights", () => assert.match(scopeOf(facebookAdapter as OAuthAdapter), /read_insights/));

  it("reads reactions, comments, shares and post_media_view views", async () => {
    net.on("GET", `${G}/p1_777`, () => ({ reactions: { summary: { total_count: 12 } }, comments: { summary: { total_count: 3 } }, shares: { count: 2 } }));
    net.on("GET", `${G}/p1_777/insights`, () => ({ data: [{ name: "post_media_view", period: "lifetime", values: [{ value: 450 }] }] }));
    const out = await posts(facebookAdapter as OAuthAdapter, ctx(), ["p1_777"]);
    assert.deepEqual(out, { p1_777: { likes: 12, comments: 3, shares: 2, views: 450 } });
    const basic = net.one("GET", `${G}/p1_777`);
    assert.match(decodeURIComponent(basic.url), /fields=reactions\.summary\(total_count\)\.limit\(0\),comments\.summary\(total_count\)\.limit\(0\),shares/);
    assert.match(basic.url, /access_token=ACCESS/);
    assert.match(net.one("GET", `${G}/p1_777/insights`).url, /metric=post_media_view/);
  });

  it("keeps basic counts when insights are not permitted, defaults missing shares to 0, and skips deleted posts", async () => {
    net.on("GET", `${G}/p1_1`, () => ({ reactions: { summary: { total_count: 1 } }, comments: { summary: { total_count: 0 } } }));
    net.on("GET", `${G}/p1_1/insights`, () => json({ error: { code: 10, message: "(#10) Application does not have permission for this action" } }, 400));
    net.on("GET", `${G}/p1_gone`, () => json({ error: { code: 100, error_subcode: 33, message: "Object with ID 'p1_gone' does not exist" } }, 400));
    const one = await posts(facebookAdapter as OAuthAdapter, ctx(), ["p1_1"]);
    assert.deepEqual(one, { p1_1: { likes: 1, comments: 0, shares: 0, views: null } });
    const gone = await posts(facebookAdapter as OAuthAdapter, ctx(), ["p1_gone"]);
    assert.deepEqual(gone, {});
  });

  it("reads video posts (ids without an underscore) from the video object", async () => {
    net.on("GET", `${G}/v99`, () => ({ likes: { summary: { total_count: 5 } }, comments: { summary: { total_count: 1 } }, views: 300 }));
    const out = await posts(facebookAdapter as OAuthAdapter, ctx(), ["v99"]);
    assert.deepEqual(out, { v99: { likes: 5, comments: 1, shares: null, views: 300 } });
    assert.equal(net.find("GET", `${G}/v99/insights`).length, 0);
  });

  it("throws auth errors (expired token) instead of hiding them", async () => {
    net.on("GET", `${G}/p1_2`, () => json({ error: { code: 190, message: "Error validating access token" } }, 400));
    await rejects(posts(facebookAdapter as OAuthAdapter, ctx(), ["p1_2"]), (e) => assert.equal(e.opts.auth, true));
  });

  it("reads page followers", async () => {
    net.on("GET", `${G}/p1`, () => ({ followers_count: 1520, id: "p1" }));
    const out = await account(facebookAdapter as OAuthAdapter, ctx({ account: acct("p1") }));
    assert.deepEqual(out, { followers: 1520 });
    assert.match(net.one("GET", `${G}/p1`).url, /fields=followers_count/);
  });
});

describe("Instagram analytics", () => {
  const G = "https://graph.instagram.com/v23.0";

  it("asks for instagram_business_manage_insights", () => assert.match(scopeOf(instagramAdapter as OAuthAdapter), /instagram_business_manage_insights/));

  it("reads counts and views/reach/saved/shares insights (both response shapes)", async () => {
    net.on("GET", `${G}/m1`, () => ({ like_count: 40, comments_count: 6, id: "m1" }));
    net.on("GET", `${G}/m1/insights`, () => ({
      data: [
        { name: "views", period: "lifetime", values: [{ value: 900 }] },
        { name: "reach", total_value: { value: 700 } },
        { name: "saved", values: [{ value: 8 }] },
        { name: "shares", values: [{ value: 3 }] },
      ],
    }));
    const out = await posts(instagramAdapter as OAuthAdapter, ctx(), ["m1"]);
    assert.deepEqual(out, { m1: { likes: 40, comments: 6, views: 900, reach: 700, saves: 8, shares: 3 } });
    const insights = net.one("GET", `${G}/m1/insights`);
    assert.match(insights.url, /metric=views%2Creach%2Csaved%2Cshares/);
    assert.doesNotMatch(insights.url, /impressions/);
  });

  it("still returns likes and comments when insights fail for a missing permission", async () => {
    net.on("GET", `${G}/m2`, () => ({ like_count: 4, comments_count: 1 }));
    net.on("GET", `${G}/m2/insights`, () => json({ error: { code: 10, message: "(#10) Application does not have permission for this action" } }, 400));
    const out = await posts(instagramAdapter as OAuthAdapter, ctx(), ["m2"]);
    assert.deepEqual(out, { m2: { likes: 4, comments: 1 } });
  });

  it("reads followers, following and media count", async () => {
    net.on("GET", `${G}/me`, () => ({ followers_count: 2048, follows_count: 180, media_count: 96 }));
    const out = await account(instagramAdapter as OAuthAdapter, ctx());
    assert.deepEqual(out, { followers: 2048, following: 180, posts: 96 });
    assert.match(net.one("GET", `${G}/me`).url, /fields=followers_count%2Cfollows_count%2Cmedia_count/);
  });
});

describe("Threads analytics", () => {
  const T = "https://graph.threads.net/v1.0";

  it("asks for threads_manage_insights", () => assert.match(scopeOf(threadsAdapter as OAuthAdapter), /threads_manage_insights/));

  it("maps replies to comments and adds reposts and shares", async () => {
    net.on("GET", `${T}/t1/insights`, () => ({
      data: [
        { name: "views", values: [{ value: 1200 }] },
        { name: "likes", values: [{ value: 50 }] },
        { name: "replies", values: [{ value: 7 }] },
        { name: "reposts", values: [{ value: 4 }] },
        { name: "quotes", values: [{ value: 2 }] },
        { name: "shares", values: [{ value: 1 }] },
      ],
    }));
    const out = await posts(threadsAdapter as OAuthAdapter, ctx(), ["t1"]);
    assert.deepEqual(out, { t1: { views: 1200, likes: 50, comments: 7, shares: 5, quotes: 2 } });
    assert.match(net.one("GET", `${T}/t1/insights`).url, /metric=views%2Clikes%2Creplies%2Creposts%2Cquotes%2Cshares/);
  });

  it("reads followers from threads_insights total_value", async () => {
    net.on("GET", `${T}/U1/threads_insights`, () => ({ data: [{ name: "followers_count", total_value: { value: 333 } }] }));
    const out = await account(threadsAdapter as OAuthAdapter, ctx({ account: acct("U1") }));
    assert.deepEqual(out, { followers: 333 });
    assert.match(net.one("GET", `${T}/U1/threads_insights`).url, /metric=followers_count/);
  });
});

describe("TikTok analytics", () => {
  const A = "https://open.tiktokapis.com";
  const ok = { error: { code: "ok", message: "" } };

  it("asks for video.list and user.info.stats", () => {
    const scope = scopeOf(tiktokAdapter as OAuthAdapter);
    assert.match(scope, /video\.list/);
    assert.match(scope, /user\.info\.stats/);
  });

  it("skips non-numeric ids and batches 20 ids per query", async () => {
    net.on("POST", `${A}/v2/video/query/?fields=`, (c) => ({
      ...ok,
      data: { videos: c.json.filters.video_ids.map((id: string) => ({ id, view_count: 100, like_count: 10, comment_count: 2, share_count: 1 })) },
    }));
    const ids = Array.from({ length: 25 }, (_, i) => String(7000 + i));
    const out = await posts(tiktokAdapter as OAuthAdapter, ctx(), [...ids, "v_pub_url~abc"]);
    const calls = net.find("POST", `${A}/v2/video/query/?fields=`);
    assert.equal(calls.length, 2);
    assert.equal(calls[0].json.filters.video_ids.length, 20);
    assert.equal(calls[1].json.filters.video_ids.length, 5);
    assert.match(calls[0].url, /fields=id,view_count,like_count,comment_count,share_count/);
    assert.equal(calls[0].headers.authorization, "Bearer ACCESS");
    assert.equal(Object.keys(out).length, 25);
    assert.deepEqual(out["7000"], { views: 100, likes: 10, comments: 2, shares: 1 });
    assert.equal(out["v_pub_url~abc"], undefined);
  });

  it("does not call the API when no id can be queried", async () => {
    const out = await posts(tiktokAdapter as OAuthAdapter, ctx(), ["v_pub_only"]);
    assert.deepEqual(out, {});
    assert.equal(net.calls.length, 0);
  });

  it("treats a missing analytics scope as a normal error, not a disconnected account", async () => {
    net.on("POST", `${A}/v2/video/query/?fields=`, () => ({ error: { code: "scope_not_authorized", message: "video.list missing" } }));
    await rejects(posts(tiktokAdapter as OAuthAdapter, ctx(), ["7001"]), (e) => {
      assert.equal(e.opts.auth, false);
      assert.match(e.message, /Reconnect/);
    });
  });

  it("reads follower, following and video counts", async () => {
    net.on("GET", `${A}/v2/user/info/?fields=`, () => ({ ...ok, data: { user: { follower_count: 5000, following_count: 12, video_count: 44 } } }));
    const out = await account(tiktokAdapter as OAuthAdapter, ctx());
    assert.deepEqual(out, { followers: 5000, following: 12, posts: 44 });
    assert.match(net.one("GET", `${A}/v2/user/info/?fields=`).url, /fields=follower_count,following_count,video_count/);
  });
});

describe("Pinterest analytics", () => {
  const P = "https://api.pinterest.com/v5";

  it("reads a 90 day window of impressions, saves and clicks", async () => {
    net.on("GET", `${P}/pins/pin9/analytics`, () => ({ all: { summary_metrics: { IMPRESSION: 800, SAVE: 12, PIN_CLICK: 30, OUTBOUND_CLICK: 9 } } }));
    const out = await posts(pinterestAdapter as OAuthAdapter, ctx(), ["pin9"]);
    assert.deepEqual(out, { pin9: { impressions: 800, saves: 12, clicks: 39 } });
    const url = new URL(net.one("GET", `${P}/pins/pin9/analytics`).url);
    assert.equal(url.searchParams.get("metric_types"), "IMPRESSION,SAVE,PIN_CLICK,OUTBOUND_CLICK");
    const start = new Date(url.searchParams.get("start_date")!);
    const end = new Date(url.searchParams.get("end_date")!);
    const days = Math.round((end.getTime() - start.getTime()) / 86400_000);
    assert.equal(days, 89);
    assert.equal(url.searchParams.get("end_date"), new Date().toISOString().slice(0, 10));
  });

  it("accepts lifetime_metrics and skips pins that no longer exist", async () => {
    net.on("GET", `${P}/pins/pinA/analytics`, () => ({ all: { lifetime_metrics: { IMPRESSION: 5, SAVE: 0 } } }));
    net.on("GET", `${P}/pins/pinGone/analytics`, () => json({ code: 50, message: "Pin not found." }, 404));
    assert.deepEqual(await posts(pinterestAdapter as OAuthAdapter, ctx(), ["pinA"]), { pinA: { impressions: 5, saves: 0, clicks: null } });
    assert.deepEqual(await posts(pinterestAdapter as OAuthAdapter, ctx(), ["pinGone"]), {});
  });

  it("reads followers, following and pin count", async () => {
    net.on("GET", `${P}/user_account`, () => ({ username: "maker", follower_count: 900, following_count: 50, pin_count: 210 }));
    const out = await account(pinterestAdapter as OAuthAdapter, ctx());
    assert.deepEqual(out, { followers: 900, following: 50, posts: 210 });
  });
});

describe("Reddit analytics", () => {
  it("asks for the read scope", () => assert.match(scopeOf(redditAdapter as OAuthAdapter), /\bread\b/));

  it("adds t3_ prefixes, keys results by the original id and maps score", async () => {
    net.on("GET", "https://oauth.reddit.com/api/info", () => ({
      data: {
        children: [
          { kind: "t3", data: { name: "t3_abc", score: 42, num_comments: 7, view_count: null } },
          { kind: "t3", data: { name: "t3_def", score: 3, num_comments: 0, view_count: 120 } },
        ],
      },
    }));
    const out = await posts(redditAdapter as OAuthAdapter, ctx(), ["t3_abc", "def", "t3_missing"]);
    assert.deepEqual(out, {
      t3_abc: { likes: 42, comments: 7, views: null },
      def: { likes: 3, comments: 0, views: 120 },
    });
    const call = net.one("GET", "https://oauth.reddit.com/api/info");
    assert.equal(new URL(call.url).searchParams.get("id"), "t3_abc,t3_def,t3_missing");
    assert.ok(call.headers["user-agent"]);
    assert.equal(call.headers.authorization, "Bearer ACCESS");
  });

  it("batches 100 ids per request", async () => {
    net.on("GET", "https://oauth.reddit.com/api/info", () => ({ data: { children: [] } }));
    await posts(redditAdapter as OAuthAdapter, ctx(), Array.from({ length: 150 }, (_, i) => `t3_${i}`));
    const calls = net.find("GET", "https://oauth.reddit.com/api/info");
    assert.equal(calls.length, 2);
    assert.equal(new URL(calls[0].url).searchParams.get("id")!.split(",").length, 100);
  });

  it("reads followers from the user's profile subreddit", async () => {
    net.on("GET", "https://oauth.reddit.com/api/v1/me", () => ({ name: "jane", subreddit: { subscribers: 77 } }));
    assert.deepEqual(await account(redditAdapter as OAuthAdapter, ctx()), { followers: 77, posts: null });
  });
});
