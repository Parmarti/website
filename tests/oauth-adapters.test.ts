import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { MockNet, APP, ctx, json, formDataEntries } from "./helpers";
import { PlatformError } from "../src/lib/platforms/http";
import { twitterAdapter } from "../src/lib/platforms/twitter";
import { linkedinAdapter, toLittleText } from "../src/lib/platforms/linkedin";
import { facebookAdapter } from "../src/lib/platforms/facebook";
import { instagramAdapter } from "../src/lib/platforms/instagram";
import { threadsAdapter } from "../src/lib/platforms/threads";
import { tiktokAdapter } from "../src/lib/platforms/tiktok";
import { youtubeAdapter } from "../src/lib/platforms/youtube";
import { pinterestAdapter } from "../src/lib/platforms/pinterest";
import { redditAdapter } from "../src/lib/platforms/reddit";
import { googleBusinessAdapter } from "../src/lib/platforms/googlebusiness";

let net: MockNet;
beforeEach(() => {
  net = new MockNet().media().install();
});
afterEach(() => net.restore());

const REDIRECT = "https://app.test/api/connect/x/callback";

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

describe("X (twitter)", () => {
  it("builds a PKCE authorize URL", () => {
    const url = new URL(twitterAdapter.kind === "oauth" ? twitterAdapter.getAuthUrl({ app: APP, redirectUri: REDIRECT, state: "s1", codeChallenge: "chal" }) : "");
    assert.equal(url.origin + url.pathname, "https://x.com/i/oauth2/authorize");
    assert.equal(url.searchParams.get("code_challenge"), "chal");
    assert.equal(url.searchParams.get("code_challenge_method"), "S256");
    assert.match(url.searchParams.get("scope")!, /tweet\.write.*offline\.access.*media\.write/);
  });

  it("exchanges the code with basic auth and the PKCE verifier", async () => {
    net.on("POST", "https://api.x.com/2/oauth2/token", () => ({ access_token: "AT", refresh_token: "RT", expires_in: 7200 }));
    net.on("GET", "https://api.x.com/2/users/me", () => ({ data: { id: "42", username: "jane", name: "Jane", profile_image_url: "https://pbs/x.jpg" } }));
    const [acc] = await twitterAdapter.exchangeCode({ app: APP, code: "CODE", redirectUri: REDIRECT, codeVerifier: "VER" });
    const call = net.one("POST", "https://api.x.com/2/oauth2/token");
    assert.equal(call.headers.authorization, "Basic " + Buffer.from("client-id:client-secret").toString("base64"));
    assert.equal(call.form!.get("code_verifier"), "VER");
    assert.equal(call.form!.get("grant_type"), "authorization_code");
    assert.equal(acc.platformAccountId, "42");
    assert.equal(acc.username, "jane");
    assert.equal(acc.token.refreshToken, "RT");
    assert.ok(acc.token.expiresAt instanceof Date);
  });

  it("uploads images with the chunked v2 flow and posts a thread", async () => {
    let n = 0;
    net.on("POST", "https://api.x.com/2/media/upload/initialize", () => ({ data: { id: `M${++n}` } }));
    net.on("POST", /\/2\/media\/upload\/M\d\/append$/, () => new Response(null, { status: 204 }));
    net.on("POST", /\/2\/media\/upload\/M\d\/finalize$/, () => ({ data: { id: "M" } }));
    net.on("POST", "https://api.x.com/2/media/metadata", () => ({ data: {} }));
    let t = 0;
    net.on("POST", "https://api.x.com/2/tweets", () => ({ data: { id: `T${++t}` } }));
    const res = await twitterAdapter.publish(
      ctx({
        content: "Launch!",
        media: [
          { type: "image", url: "https://media.test/photo.jpg", altText: "A photo" },
          { type: "image", url: "https://media.test/anim.gif" },
        ],
        options: { threadItems: ["second", "third"] },
      }),
    );
    const inits = net.find("POST", "https://api.x.com/2/media/upload/initialize");
    assert.equal(inits.length, 2);
    assert.equal(inits[0].json.media_category, "tweet_image");
    assert.equal(inits[0].json.total_bytes, 2048);
    assert.equal(inits[1].json.media_category, "tweet_gif");
    const append = await formDataEntries(net.find("POST", /append$/)[0].body);
    assert.equal(append.segment_index, "0");
    const tweets = net.find("POST", "https://api.x.com/2/tweets");
    assert.equal(tweets.length, 3);
    assert.deepEqual(tweets[0].json.media.media_ids, ["M1", "M2"]);
    assert.equal(tweets[1].json.reply.in_reply_to_tweet_id, "T1");
    assert.equal(tweets[2].json.reply.in_reply_to_tweet_id, "T2");
    assert.equal(net.find("POST", "https://api.x.com/2/media/metadata").length, 1);
    assert.equal(res.platformPostId, "T1");
    assert.equal(res.url, "https://x.com/tester/status/T1");
  });

  it("waits for video processing before posting", async () => {
    net.on("POST", "https://api.x.com/2/media/upload/initialize", () => ({ data: { id: "V1" } }));
    net.on("POST", /append$/, () => new Response(null, { status: 204 }));
    net.on("POST", /finalize$/, () => ({ data: { id: "V1", processing_info: { state: "pending", check_after_secs: 0 } } }));
    net.on("GET", "https://api.x.com/2/media/upload?", () => ({ data: { processing_info: { state: "succeeded" } } }));
    net.on("POST", "https://api.x.com/2/tweets", () => ({ data: { id: "T9" } }));
    await twitterAdapter.publish(ctx({ media: [{ type: "video", url: "https://media.test/clip.mp4" }] }));
    // 9 MB in 4 MB chunks = 3 appends.
    assert.equal(net.find("POST", /append$/).length, 3);
    const status = net.one("GET", "https://api.x.com/2/media/upload?");
    assert.match(status.url, /command=STATUS/);
    assert.deepEqual(net.one("POST", "https://api.x.com/2/tweets").json.media.media_ids, ["V1"]);
  });

  it("validates length, media mix and threads", () => {
    assert.ok(twitterAdapter.validate!({ content: "x".repeat(281), media: [], options: {} }).length > 0);
    assert.equal(twitterAdapter.validate!({ content: "x".repeat(250) + " https://example.com/a/very/long/link/that/counts/as/23", media: [], options: {} }).length, 0);
    assert.ok(twitterAdapter.validate!({ content: "hi", media: [{ type: "video", url: "a.mp4" }, { type: "image", url: "b.jpg" }], options: {} }).length > 0);
  });

  it("maps refresh failures to auth errors", async () => {
    net.on("POST", "https://api.x.com/2/oauth2/token", () => json({ error: "invalid_request" }, 400));
    await rejects(twitterAdapter.refresh!({ app: APP, refreshToken: "RT", accessToken: "AT" }), (e) => assert.equal(e.opts.auth, true));
  });
});

describe("LinkedIn", () => {
  it("escapes little text and keeps hashtags clickable", () => {
    assert.equal(toLittleText("Hi (team) #launch_day @jane C# 50%_off"), "Hi \\(team\\) {hashtag|\\#|launch_day} \\@jane C\\# 50%\\_off");
  });

  it("exchanges the code and reads the OpenID profile", async () => {
    net.on("POST", "https://www.linkedin.com/oauth/v2/accessToken", () => ({ access_token: "AT", expires_in: 5184000 }));
    net.on("GET", "https://api.linkedin.com/v2/userinfo", () => ({ sub: "abc123", name: "Jane Doe", email: "jane@x.com", picture: "https://p" }));
    const [acc] = await linkedinAdapter.exchangeCode({ app: APP, code: "C", redirectUri: REDIRECT });
    assert.equal(acc.platformAccountId, "abc123");
    assert.equal(acc.metadata!.authorUrn, "urn:li:person:abc123");
    assert.equal(net.one("POST", "https://www.linkedin.com/oauth/v2/accessToken").form!.get("client_secret"), "client-secret");
  });

  it("publishes multi-image posts with the versioned REST API", async () => {
    let i = 0;
    net.on("POST", "https://api.linkedin.com/rest/images?action=initializeUpload", () => ({
      value: { uploadUrl: `https://upload.linkedin.test/${++i}`, image: `urn:li:image:${i}` },
    }));
    net.on("PUT", /^https:\/\/upload\.linkedin\.test\//, () => new Response(null, { status: 201 }));
    net.on("POST", "https://api.linkedin.com/rest/posts", () => new Response(null, { status: 201, headers: { "x-restli-id": "urn:li:share:999" } }));
    const res = await linkedinAdapter.publish(
      ctx({
        account: { id: "a", platformAccountId: "abc123", username: null, metadata: { authorUrn: "urn:li:person:abc123" } },
        content: "New (beta) #release",
        media: [
          { type: "image", url: "https://media.test/photo.jpg", altText: "one" },
          { type: "image", url: "https://media.test/photo2.jpg" },
        ],
      }),
    );
    const post = net.one("POST", "https://api.linkedin.com/rest/posts");
    assert.match(post.headers["linkedin-version"], /^\d{6}$/);
    assert.equal(post.headers["x-restli-protocol-version"], "2.0.0");
    assert.equal(post.json.author, "urn:li:person:abc123");
    assert.equal(post.json.commentary, "New \\(beta\\) {hashtag|\\#|release}");
    assert.deepEqual(post.json.content.multiImage.images.map((x: any) => x.id), ["urn:li:image:1", "urn:li:image:2"]);
    assert.equal(net.find("PUT", /^https:\/\/upload\.linkedin\.test\//).length, 2);
    assert.equal(res.url, "https://www.linkedin.com/feed/update/urn:li:share:999/");
  });

  it("marks 401 as an auth error and asks to reconnect when no refresh token", async () => {
    net.on("POST", "https://api.linkedin.com/rest/posts", () => json({ message: "expired" }, 401));
    await rejects(linkedinAdapter.publish(ctx()), (e) => assert.equal(e.opts.auth, true));
    await rejects(linkedinAdapter.refresh!({ app: APP, refreshToken: null, accessToken: "x" }), (e) => assert.equal(e.opts.auth, true));
  });
});

describe("Facebook Pages", () => {
  const G = "https://graph.facebook.com/v23.0";

  it("returns one account per Page with a page token", async () => {
    net.on("GET", `${G}/oauth/access_token?client_id`, () => ({ access_token: "SHORT" }));
    net.on("GET", `${G}/oauth/access_token?grant_type=fb_exchange_token`, () => ({ access_token: "LONG" }));
    net.on("GET", `${G}/me/accounts`, () => ({
      data: [
        { id: "p1", name: "Cafe", access_token: "PT1", picture: { data: { url: "https://pic" } } },
        { id: "p2", name: "Shop", access_token: "PT2" },
        { id: "p3", name: "No token" },
      ],
    }));
    const accounts = await facebookAdapter.exchangeCode({ app: APP, code: "C", redirectUri: REDIRECT });
    assert.equal(accounts.length, 2);
    assert.equal(accounts[0].token.accessToken, "PT1");
    assert.equal(accounts[0].token.expiresAt, null);
    assert.match(net.one("GET", `${G}/me/accounts`).url, /access_token=LONG/);
  });

  it("posts multiple photos as unpublished uploads attached to one feed post", async () => {
    let n = 0;
    net.on("POST", `${G}/p1/photos`, () => ({ id: `ph${++n}` }));
    net.on("POST", `${G}/p1/feed`, () => ({ id: "p1_777" }));
    net.on("POST", `${G}/p1_777/comments`, () => ({ id: "c1" }));
    const res = await facebookAdapter.publish(
      ctx({
        account: { id: "a", platformAccountId: "p1", username: null, metadata: {} },
        media: [
          { type: "image", url: "https://media.test/photo.jpg" },
          { type: "image", url: "https://media.test/photo2.jpg" },
        ],
        options: { firstComment: "Link in bio" },
      }),
    );
    const uploads = net.find("POST", `${G}/p1/photos`);
    assert.equal(uploads.length, 2);
    assert.equal(uploads[0].form!.get("published"), "false");
    const feed = net.one("POST", `${G}/p1/feed`);
    assert.equal(feed.form!.get("attached_media[1]"), JSON.stringify({ media_fbid: "ph2" }));
    assert.equal(feed.form!.get("message"), "Hello world");
    assert.equal(net.one("POST", `${G}/p1_777/comments`).form!.get("message"), "Link in bio");
    assert.equal(res.url, "https://www.facebook.com/p1_777");
  });

  it("sends video to the video host", async () => {
    net.on("POST", "https://graph-video.facebook.com/v23.0/p1/videos", () => ({ id: "v1" }));
    await facebookAdapter.publish(ctx({ account: { id: "a", platformAccountId: "p1", username: null, metadata: {} }, media: [{ type: "video", url: "https://media.test/clip.mp4" }] }));
    assert.equal(net.one("POST", "https://graph-video.facebook.com/v23.0/p1/videos").form!.get("file_url"), "https://media.test/clip.mp4");
  });

  it("maps Meta error codes", async () => {
    net.on("POST", `${G}/p1/feed`, () => json({ error: { code: 190, message: "Session expired" } }, 400), 1);
    await rejects(facebookAdapter.publish(ctx({ account: { id: "a", platformAccountId: "p1", username: null, metadata: {} } })), (e) => {
      assert.equal(e.opts.auth, true);
      assert.match(e.message, /Session expired/);
    });
    net.on("POST", `${G}/p1/feed`, () => json({ error: { code: 4, message: "Application request limit reached" } }, 400), 1);
    await rejects(facebookAdapter.publish(ctx({ account: { id: "a", platformAccountId: "p1", username: null, metadata: {} } })), (e) =>
      assert.equal(e.opts.retryable, true),
    );
  });
});

describe("Instagram", () => {
  const G = "https://graph.instagram.com/v23.0";

  it("exchanges for a long-lived token", async () => {
    net.on("POST", "https://api.instagram.com/oauth/access_token", () => ({ access_token: "SHORT", user_id: 1 }));
    net.on("GET", "https://graph.instagram.com/access_token", () => ({ access_token: "LONG", expires_in: 5183944 }));
    net.on("GET", `${G}/me`, () => ({ user_id: "1784", username: "cafe", name: "Cafe" }));
    const [acc] = await instagramAdapter.exchangeCode({ app: APP, code: "CODE#_", redirectUri: REDIRECT });
    assert.equal(net.one("POST", "https://api.instagram.com/oauth/access_token").form!.get("code"), "CODE");
    assert.equal(acc.platformAccountId, "1784");
    assert.equal(acc.token.accessToken, "LONG");
  });

  it("publishes a carousel after every container is ready", async () => {
    let n = 0;
    net.on("POST", `${G}/1784/media_publish`, () => ({ id: "MEDIA1" }));
    net.on("POST", `${G}/1784/media`, () => ({ id: `C${++n}` }));
    net.on("GET", new RegExp(`^${G.replace(/\./g, "\\.")}/C\\d\\?`), () => ({ status_code: "FINISHED" }));
    net.on("GET", `${G}/MEDIA1?`, () => ({ permalink: "https://instagram.com/p/abc" }));
    const res = await instagramAdapter.publish(
      ctx({
        account: { id: "a", platformAccountId: "1784", username: "cafe", metadata: {} },
        media: [
          { type: "image", url: "https://media.test/photo.jpg" },
          { type: "video", url: "https://media.test/clip.mp4" },
        ],
      }),
    );
    const containers = net.find("POST", `${G}/1784/media`);
    assert.equal(containers.length, 3);
    assert.equal(containers[0].form!.get("is_carousel_item"), "true");
    assert.equal(containers[1].form!.get("media_type"), "VIDEO");
    assert.equal(containers[2].form!.get("media_type"), "CAROUSEL");
    assert.equal(containers[2].form!.get("children"), "C1,C2");
    assert.equal(containers[2].form!.get("caption"), "Hello world");
    assert.equal(net.one("POST", `${G}/1784/media_publish`).form!.get("creation_id"), "C3");
    assert.equal(res.url, "https://instagram.com/p/abc");
  });

  it("fails when a container errors", async () => {
    net.on("POST", `${G}/1784/media`, () => ({ id: "C1" }));
    net.on("GET", `${G}/C1?`, () => ({ status_code: "ERROR", status: "Unsupported aspect ratio" }));
    await rejects(
      instagramAdapter.publish(ctx({ account: { id: "a", platformAccountId: "1784", username: null, metadata: {} }, media: [{ type: "image", url: "https://media.test/photo.jpg" }] })),
      (e) => assert.match(e.message, /aspect ratio/),
    );
  });

  it("requires media", () => {
    assert.ok(instagramAdapter.validate!({ content: "text only", media: [], options: {} }).length > 0);
  });
});

describe("Threads", () => {
  const T = "https://graph.threads.net/v1.0";
  it("publishes text with a reply chain", async () => {
    let n = 0;
    net.on("POST", `${T}/U1/threads_publish`, (c) => ({ id: `P_${c.form!.get("creation_id")}` }));
    net.on("POST", `${T}/U1/threads`, () => ({ id: `C${++n}` }));
    net.on("GET", /graph\.threads\.net\/v1\.0\/C\d\?/, () => ({ status: "FINISHED" }));
    net.on("GET", `${T}/P_C1?`, () => ({ permalink: "https://threads.net/@t/post/1" }));
    const res = await threadsAdapter.publish(ctx({ account: { id: "a", platformAccountId: "U1", username: "t", metadata: {} }, options: { replyChain: ["more"] } }));
    const creates = net.find("POST", `${T}/U1/threads`);
    assert.equal(creates[0].form!.get("media_type"), "TEXT");
    assert.equal(creates[1].form!.get("reply_to_id"), "P_C1");
    assert.equal(res.platformPostId, "P_C1");
    assert.equal(res.url, "https://threads.net/@t/post/1");
  });
});

describe("TikTok", () => {
  const A = "https://open.tiktokapis.com";
  const ok = { error: { code: "ok", message: "" } };

  it("falls back to an allowed privacy level and uploads one chunk", async () => {
    net.on("POST", `${A}/v2/post/publish/creator_info/query/`, () => ({ ...ok, data: { privacy_level_options: ["SELF_ONLY"] } }));
    net.on("POST", `${A}/v2/post/publish/video/init/`, () => ({ ...ok, data: { publish_id: "pub1", upload_url: "https://upload.tiktok.test/u" } }));
    net.on("PUT", "https://upload.tiktok.test/u", () => new Response(null, { status: 201 }));
    net.on("POST", `${A}/v2/post/publish/status/fetch/`, () => ({ ...ok, data: { status: "PUBLISH_COMPLETE", publicaly_available_post_id: [7123] } }));
    const res = await tiktokAdapter.publish(ctx({ media: [{ type: "video", url: "https://media.test/clip.mp4" }], options: { privacyLevel: "PUBLIC_TO_EVERYONE" } }));
    const init = net.one("POST", `${A}/v2/post/publish/video/init/`).json;
    assert.equal(init.post_info.privacy_level, "SELF_ONLY");
    assert.deepEqual(init.source_info, { source: "FILE_UPLOAD", video_size: 9437184, chunk_size: 9437184, total_chunk_count: 1 });
    assert.equal(net.one("PUT", "https://upload.tiktok.test/u").headers["content-range"], "bytes 0-9437183/9437184");
    assert.equal(res.url, "https://www.tiktok.com/@tester/video/7123");
  });

  it("splits large videos with the last chunk taking the remainder", async () => {
    net.on("POST", `${A}/v2/post/publish/creator_info/query/`, () => ({ ...ok, data: { privacy_level_options: ["PUBLIC_TO_EVERYONE"] } }));
    net.on("POST", `${A}/v2/post/publish/video/init/`, () => ({ ...ok, data: { publish_id: "pub2", upload_url: "https://upload.tiktok.test/u" } }));
    net.on("PUT", "https://upload.tiktok.test/u", () => new Response(null, { status: 206 }));
    net.on("POST", `${A}/v2/post/publish/status/fetch/`, () => ({ ...ok, data: { status: "PUBLISH_COMPLETE" } }));
    const res = await tiktokAdapter.publish(ctx({ media: [{ type: "video", url: "https://media.test/long.mp4" }] }));
    const init = net.one("POST", `${A}/v2/post/publish/video/init/`).json;
    assert.equal(init.source_info.total_chunk_count, 7);
    const puts = net.find("PUT", "https://upload.tiktok.test/u");
    assert.equal(puts.length, 7);
    assert.equal(puts[6].headers["content-range"], "bytes 60000000-70000122/70000123");
    assert.equal(res.platformPostId, "pub2");
  });

  it("maps API error codes", async () => {
    net.on("POST", `${A}/v2/post/publish/creator_info/query/`, () => ({ error: { code: "access_token_invalid", message: "bad" } }));
    await rejects(tiktokAdapter.publish(ctx({ media: [{ type: "video", url: "https://media.test/clip.mp4" }] })), (e) => assert.equal(e.opts.auth, true));
  });
});

describe("YouTube", () => {
  it("uploads with a resumable session", async () => {
    net.on("POST", "https://www.googleapis.com/upload/youtube/v3/videos", () => new Response(null, { status: 200, headers: { location: "https://upload.yt.test/session1" } }));
    net.on("PUT", "https://upload.yt.test/session1", () => ({ id: "vid123" }));
    const res = await youtubeAdapter.publish(ctx({ content: "My launch video\nMore details", media: [{ type: "video", url: "https://media.test/clip.mp4" }], options: { visibility: "unlisted", tags: ["a"] } }));
    const init = net.one("POST", "https://www.googleapis.com/upload/youtube/v3/videos");
    assert.match(init.url, /uploadType=resumable/);
    assert.equal(init.json.snippet.title, "My launch video");
    assert.equal(init.json.status.privacyStatus, "unlisted");
    assert.equal(init.headers["x-upload-content-length"], String(9 * 1024 * 1024));
    assert.equal(res.url, "https://www.youtube.com/watch?v=vid123");
  });
});

describe("Pinterest", () => {
  it("connects with boards and pins to the first board by default", async () => {
    net.on("POST", "https://api.pinterest.com/v5/oauth/token", () => ({ access_token: "AT", refresh_token: "RT", expires_in: 2592000 }));
    net.on("GET", "https://api.pinterest.com/v5/user_account", () => ({ username: "maker", profile_image: "https://img" }));
    net.on("GET", "https://api.pinterest.com/v5/boards", () => ({ items: [{ id: "b1", name: "Ideas" }] }));
    const [acc] = await pinterestAdapter.exchangeCode({ app: APP, code: "C", redirectUri: REDIRECT });
    assert.deepEqual(acc.metadata!.boards, [{ id: "b1", name: "Ideas" }]);
    net.on("POST", "https://api.pinterest.com/v5/pins", () => ({ id: "pin9" }));
    await pinterestAdapter.publish(ctx({ account: { id: "a", platformAccountId: "maker", username: "maker", metadata: acc.metadata! }, media: [{ type: "image", url: "https://media.test/photo.jpg" }], options: { title: "T" } }));
    const pin = net.one("POST", "https://api.pinterest.com/v5/pins").json;
    assert.equal(pin.board_id, "b1");
    assert.equal(pin.media_source.source_type, "image_url");
  });
});

describe("Reddit", () => {
  it("requires subreddit and title", () => {
    assert.equal(redditAdapter.validate!({ content: "x", media: [], options: {} }).length, 2);
  });
  it("submits a text post and surfaces Reddit errors", async () => {
    net.on("POST", "https://oauth.reddit.com/api/submit", () => ({ json: { errors: [], data: { name: "t3_abc", url: "https://reddit.com/r/test/abc" } } }), 1);
    const res = await redditAdapter.publish(ctx({ options: { subreddit: "r/test", title: "Hi" } }));
    const call = net.one("POST", "https://oauth.reddit.com/api/submit");
    assert.equal(call.form!.get("sr"), "test");
    assert.equal(call.form!.get("kind"), "self");
    assert.ok(call.headers["user-agent"]);
    assert.equal(res.platformPostId, "t3_abc");
    net.on("POST", "https://oauth.reddit.com/api/submit", () => ({ json: { errors: [["RATELIMIT", "try again in 5 minutes", "ratelimit"]] } }));
    await rejects(redditAdapter.publish(ctx({ options: { subreddit: "test", title: "Hi" } })), (e) => assert.equal(e.opts.retryable, true));
  });
});

describe("Google Business", () => {
  it("lists every location across pages", async () => {
    net.on("POST", "https://oauth2.googleapis.com/token", () => ({ access_token: "AT", refresh_token: "RT", expires_in: 3599 }));
    net.on("GET", "https://mybusinessaccountmanagement.googleapis.com/v1/accounts", () => ({ accounts: [{ name: "accounts/1" }] }));
    net.on("GET", /locations\?.*pageToken=n2/, () => ({ locations: [{ name: "locations/30", title: "Third" }] }));
    net.on("GET", "https://mybusinessbusinessinformation.googleapis.com/v1/accounts/1/locations", () => ({
      locations: [
        { name: "locations/10", title: "Downtown", storefrontAddress: { locality: "Austin", administrativeArea: "TX" } },
        { name: "locations/20", title: "Uptown" },
      ],
      nextPageToken: "n2",
    }));
    const accounts = await googleBusinessAdapter.exchangeCode({ app: APP, code: "C", redirectUri: REDIRECT });
    assert.deepEqual(accounts.map((a) => a.platformAccountId), ["10", "20", "30"]);
    assert.equal(accounts[0].username, "Austin, TX");
    assert.equal(accounts[0].metadata!.accountName, "accounts/1");
  });

  it("creates an event post with a button and photo", async () => {
    net.on("POST", "https://mybusiness.googleapis.com/v4/accounts/1/locations/10/localPosts", () => ({ name: "accounts/1/locations/10/localPosts/99", searchUrl: "https://local.google.com/p/99" }));
    const res = await googleBusinessAdapter.publish(
      ctx({
        account: { id: "a", platformAccountId: "10", username: null, metadata: { accountName: "accounts/1" } },
        media: [{ type: "image", url: "https://media.test/photo.jpg" }],
        options: { topicType: "event", eventTitle: "Tasting", eventStart: "2026-12-05T18:00", eventEnd: "2026-12-05T21:30", callToActionType: "book", callToActionUrl: "https://book" },
      }),
    );
    const body = net.one("POST", "https://mybusiness.googleapis.com/v4/accounts/1/locations/10/localPosts").json;
    assert.equal(body.topicType, "EVENT");
    assert.deepEqual(body.event.schedule.startDate, { year: 2026, month: 12, day: 5 });
    assert.equal(body.event.schedule.endTime.minutes, 30);
    assert.deepEqual(body.callToAction, { actionType: "BOOK", url: "https://book" });
    assert.equal(body.media[0].mediaFormat, "PHOTO");
    assert.equal(res.url, "https://local.google.com/p/99");
  });

  it("rejects phone numbers in text", () => {
    assert.ok(googleBusinessAdapter.validate!({ content: "Call us at +1 (512) 555-0100", media: [], options: {} }).length > 0);
    assert.equal(googleBusinessAdapter.validate!({ content: "Open 9 to 5 on 12/24", media: [], options: {} }).length, 0);
  });
});
