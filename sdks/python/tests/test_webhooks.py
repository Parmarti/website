import hashlib
import hmac
import json
import time
import unittest

from fanout import FanoutError, construct_webhook_event, verify_webhook_signature

SECRET = "whsec_test_secret"
BODY = json.dumps({"id": "evt_1", "event": "post.published", "createdAt": "2026-11-08T00:00:00.000Z", "data": {"id": "post_1"}})


def sign(raw, t, key=SECRET):
    return f"t={t},v1=" + hmac.new(key.encode(), f"{t}.{raw}".encode(), hashlib.sha256).hexdigest()


def now():
    return int(time.time())


class WebhookTest(unittest.TestCase):
    def test_valid(self):
        self.assertTrue(verify_webhook_signature(BODY, sign(BODY, now()), SECRET))

    def test_bytes_body(self):
        self.assertTrue(verify_webhook_signature(BODY.encode(), sign(BODY, now()), SECRET))

    def test_wrong_secret(self):
        self.assertFalse(verify_webhook_signature(BODY, sign(BODY, now(), "whsec_other"), SECRET))

    def test_tampered_body(self):
        self.assertFalse(verify_webhook_signature(BODY.replace("post_1", "post_2"), sign(BODY, now()), SECRET))

    def test_expired_and_tolerance(self):
        old = now() - 600
        self.assertFalse(verify_webhook_signature(BODY, sign(BODY, old), SECRET))
        self.assertTrue(verify_webhook_signature(BODY, sign(BODY, old), SECRET, tolerance=900))
        self.assertTrue(verify_webhook_signature(BODY, sign(BODY, old), SECRET, tolerance=0))

    def test_malformed_headers(self):
        for header in [None, "", "garbage", f"t={now()}", "v1=abc", "t=abc,v1=abc", f"t={now()},v1=short"]:
            self.assertFalse(verify_webhook_signature(BODY, header, SECRET), header)

    def test_multiple_signatures(self):
        t = now()
        good = sign(BODY, t).split(",")[1]
        self.assertTrue(verify_webhook_signature(BODY, f"t={t},v1={'0' * 64},{good}", SECRET))

    def test_construct_event(self):
        event = construct_webhook_event(BODY, sign(BODY, now()), SECRET)
        self.assertEqual(event["event"], "post.published")
        with self.assertRaises(FanoutError) as ctx:
            construct_webhook_event(BODY, sign(BODY, now(), "nope"), SECRET)
        self.assertEqual(ctx.exception.code, "invalid_signature")


if __name__ == "__main__":
    unittest.main()
