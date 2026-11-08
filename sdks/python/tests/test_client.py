import json
import threading
import unittest
from datetime import datetime
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import parse_qsl, urlsplit

from fanout import Fanout, FanoutError

RECORDED = []
REPLIES = {}

POST = {"id": "post_1", "status": "scheduled", "platforms": []}


def reply(key, *replies):
    """Queue replies for "METHOD /path": (status, body, headers). The last one repeats."""
    REPLIES[key] = list(replies)


class Handler(BaseHTTPRequestHandler):
    def log_message(self, *args):  # silence test output
        pass

    def _handle(self):
        length = int(self.headers.get("Content-Length") or 0)
        raw = self.rfile.read(length) if length else b""
        parts = urlsplit(self.path)
        RECORDED.append(
            {
                "method": self.command,
                "path": parts.path,
                "query": dict(parse_qsl(parts.query)),
                "headers": dict(self.headers),
                "body": json.loads(raw) if raw else None,
            }
        )
        queue = REPLIES.get(f"{self.command} {parts.path}")
        if queue:
            status, body, headers = queue.pop(0) if len(queue) > 1 else queue[0]
        else:
            status, body, headers = 404, {"error": {"code": "not_found", "message": "no mock"}}, {}
        payload = b"" if body is None else json.dumps(body).encode()
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(payload)))
        for k, v in (headers or {}).items():
            self.send_header(k, v)
        self.end_headers()
        self.wfile.write(payload)

    do_GET = do_POST = do_PATCH = do_DELETE = _handle


class ClientTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.server = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
        cls.base = f"http://127.0.0.1:{cls.server.server_address[1]}"
        threading.Thread(target=cls.server.serve_forever, daemon=True).start()

    @classmethod
    def tearDownClass(cls):
        cls.server.shutdown()
        cls.server.server_close()

    def client(self, **kw):
        return Fanout(api_key="fo_live_test", base_url=self.base, **kw)

    def last(self):
        return RECORDED[-1]

    def test_auth_header_and_base_url(self):
        reply("GET /api/v1/usage", (200, {"plan": "free", "accounts": {"used": 0, "limit": 2}, "postsThisMonth": {"used": 0, "limit": 100}}, {}))
        self.assertEqual(self.client().usage.get()["plan"], "free")
        self.assertEqual(self.last()["headers"]["Authorization"], "Bearer fo_live_test")
        self.assertTrue(self.last()["headers"]["User-Agent"].startswith("fanout-python/"))

    def test_base_url_with_api_v1_suffix(self):
        c = Fanout(api_key="k", base_url=self.base + "/api/v1/")
        self.assertEqual(c.base_url, self.base + "/api/v1")

    def test_requires_api_key(self):
        with self.assertRaises(ValueError):
            Fanout(api_key="")

    def test_posts_create(self):
        reply("POST /api/v1/posts", (201, {"post": POST}, {}))
        post = self.client().posts.create(
            content="hi",
            platforms=[{"platform": "linkedin", "accountId": "acc_1", "platformSpecificData": {"visibility": "PUBLIC"}}],
            media_items=[{"url": "https://cdn.example.com/a.png"}],
            scheduled_for=datetime(2026, 12, 1, 9, 0),
            timezone="Europe/Madrid",
            external_id="ext-1",
        )
        self.assertEqual(post["id"], "post_1")
        self.assertEqual(self.last()["method"], "POST")
        self.assertEqual(self.last()["headers"]["Content-Type"], "application/json")
        self.assertEqual(
            self.last()["body"],
            {
                "content": "hi",
                "platforms": [{"platform": "linkedin", "accountId": "acc_1", "platformSpecificData": {"visibility": "PUBLIC"}}],
                "mediaItems": [{"url": "https://cdn.example.com/a.png"}],
                "scheduledFor": "2026-12-01T09:00:00",
                "timezone": "Europe/Madrid",
                "externalId": "ext-1",
            },
        )

    def test_posts_list_and_iterate(self):
        reply("GET /api/v1/posts", (200, {"posts": [POST], "nextCursor": None}, {}))
        page = self.client().posts.list(limit=5, status="failed")
        self.assertEqual(len(page["posts"]), 1)
        self.assertEqual(self.last()["query"], {"limit": "5", "status": "failed"})

        reply(
            "GET /api/v1/posts",
            (200, {"posts": [{"id": "a"}, {"id": "b"}], "nextCursor": "b"}, {}),
            (200, {"posts": [{"id": "c"}], "nextCursor": None}, {}),
        )
        ids = [p["id"] for p in self.client().posts.iterate(limit=2)]
        self.assertEqual(ids, ["a", "b", "c"])
        self.assertEqual(self.last()["query"], {"limit": "2", "cursor": "b"})

    def test_posts_get_delete_cancel_retry(self):
        reply("GET /api/v1/posts/post%2F1", (200, {"post": POST}, {}))
        reply("DELETE /api/v1/posts/post_1", (200, {"deleted": False, "cancelled": True}, {}))
        reply("POST /api/v1/posts/post_1/retry", (200, {"requeued": 2}, {}))
        c = self.client()
        self.assertEqual(c.posts.get("post/1")["id"], "post_1")
        self.assertEqual(self.last()["path"], "/api/v1/posts/post%2F1")
        self.assertEqual(c.posts.delete("post_1"), {"deleted": False, "cancelled": True})
        self.assertEqual(c.posts.cancel("post_1")["cancelled"], True)
        self.assertEqual(c.posts.retry("post_1"), {"requeued": 2})
        self.assertIsNone(self.last()["body"])

    def test_accounts(self):
        reply("GET /api/v1/accounts", (200, {"accounts": [{"id": "acc_1"}]}, {}))
        reply("GET /api/v1/accounts/acc_1", (200, {"account": {"id": "acc_1"}}, {}))
        reply("DELETE /api/v1/accounts/acc_1", (200, {"deleted": True}, {}))
        c = self.client()
        self.assertEqual(c.accounts.list(platform="bluesky", profile_id="p1")[0]["id"], "acc_1")
        self.assertEqual(self.last()["query"], {"platform": "bluesky", "profileId": "p1"})
        self.assertEqual(c.accounts.get("acc_1")["id"], "acc_1")
        self.assertEqual(c.accounts.disconnect("acc_1"), {"deleted": True})
        self.assertEqual(self.last()["method"], "DELETE")

    def test_profiles(self):
        reply("GET /api/v1/profiles", (200, {"profiles": [{"id": "p1"}]}, {}))
        reply("POST /api/v1/profiles", (201, {"profile": {"id": "p2", "name": "Client"}}, {}))
        reply("GET /api/v1/profiles/p2", (200, {"profile": {"id": "p2"}}, {}))
        reply("PATCH /api/v1/profiles/p2", (200, {"profile": {"id": "p2", "name": "Renamed"}}, {}))
        reply("DELETE /api/v1/profiles/p2", (200, {"deleted": True}, {}))
        c = self.client()
        self.assertEqual(c.profiles.list()[0]["id"], "p1")
        self.assertEqual(c.profiles.create("Client")["id"], "p2")
        self.assertEqual(self.last()["body"], {"name": "Client"})
        self.assertEqual(c.profiles.get("p2")["id"], "p2")
        c.profiles.update("p2", name="Renamed", description=None)
        self.assertEqual(self.last()["method"], "PATCH")
        self.assertEqual(self.last()["body"], {"name": "Renamed", "description": None})
        c.profiles.update("p2", name="Only name")
        self.assertEqual(self.last()["body"], {"name": "Only name"})
        self.assertEqual(c.profiles.delete("p2"), {"deleted": True})

    def test_connect_platforms_webhooks(self):
        reply("GET /api/v1/connect/instagram", (200, {"authUrl": "https://x/connect", "expiresInSeconds": 1800}, {}))
        reply("GET /api/v1/platforms", (200, {"platforms": [{"id": "bluesky"}]}, {}))
        reply("GET /api/v1/webhooks", (200, {"webhooks": []}, {}))
        reply("POST /api/v1/webhooks", (201, {"webhook": {"id": "wh_1", "secret": "whsec_x"}}, {}))
        reply("DELETE /api/v1/webhooks/wh_1", (200, {"deleted": True}, {}))
        reply("POST /api/v1/webhooks/wh_1/test", (200, {"delivered": True, "status": 200, "error": None}, {}))
        c = self.client()
        r = c.connect.get_url("instagram", profile_id="p1", redirect_url="https://app.example.com/done?x=1")
        self.assertEqual(r["expiresInSeconds"], 1800)
        self.assertEqual(self.last()["query"], {"profileId": "p1", "redirectUrl": "https://app.example.com/done?x=1"})
        self.assertEqual(c.platforms.list()[0]["id"], "bluesky")
        self.assertEqual(c.webhooks.list(), [])
        self.assertEqual(c.webhooks.create("https://app.example.com/hook", events=["post.published"])["secret"], "whsec_x")
        self.assertEqual(self.last()["body"], {"url": "https://app.example.com/hook", "events": ["post.published"]})
        self.assertTrue(c.webhooks.test("wh_1")["delivered"])
        self.assertEqual(c.webhooks.delete("wh_1"), {"deleted": True})

    def test_error_mapping(self):
        details = [{"accountId": "acc_1", "platform": "twitter", "errors": ["too long"]}]
        reply("POST /api/v1/posts", (422, {"error": {"code": "validation_error", "message": "Some platforms cannot accept this post.", "details": details}}, {}))
        with self.assertRaises(FanoutError) as ctx:
            self.client().posts.create(content="x" * 300, platforms=[{"accountId": "acc_1"}])
        self.assertEqual(ctx.exception.status, 422)
        self.assertEqual(ctx.exception.code, "validation_error")
        self.assertEqual(ctx.exception.details, details)

    def test_get_retries_on_503(self):
        before = len(RECORDED)
        reply(
            "GET /api/v1/accounts",
            (503, {"error": {"code": "internal_error", "message": "busy"}}, {"Retry-After": "0"}),
            (200, {"accounts": []}, {}),
        )
        self.assertEqual(self.client().accounts.list(), [])
        self.assertEqual(len(RECORDED) - before, 2)

    def test_get_gives_up_after_max_retries(self):
        before = len(RECORDED)
        reply("GET /api/v1/profiles", (500, {"error": {"code": "internal_error", "message": "down"}}, {"Retry-After": "0"}))
        with self.assertRaises(FanoutError) as ctx:
            self.client().profiles.list()
        self.assertEqual(ctx.exception.status, 500)
        self.assertEqual(len(RECORDED) - before, 3)

    def test_post_is_not_retried(self):
        before = len(RECORDED)
        reply("POST /api/v1/posts", (503, {"error": {"code": "internal_error", "message": "busy"}}, {"Retry-After": "0"}))
        with self.assertRaises(FanoutError):
            self.client().posts.create(platforms=[{"accountId": "a"}])
        self.assertEqual(len(RECORDED) - before, 1)

    def test_network_error(self):
        c = Fanout(api_key="k", base_url="http://127.0.0.1:1", max_retries=0, timeout=2)
        with self.assertRaises(FanoutError) as ctx:
            c.usage.get()
        self.assertEqual(ctx.exception.status, 0)
        self.assertEqual(ctx.exception.code, "network_error")

    def test_non_json_error(self):
        reply("GET /api/v1/posts/broken", (502, None, {}))
        with self.assertRaises(FanoutError) as ctx:
            self.client(max_retries=0).posts.get("broken")
        self.assertEqual(ctx.exception.status, 502)
        self.assertEqual(str(ctx.exception), "HTTP 502")


if __name__ == "__main__":
    unittest.main()
