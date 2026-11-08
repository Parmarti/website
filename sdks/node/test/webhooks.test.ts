import { test } from "node:test";
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { constructWebhookEvent, FanoutError, verifyWebhookSignature } from "../src/index.ts";

const secret = "whsec_test_secret";
const body = JSON.stringify({ id: "evt_1", event: "post.published", createdAt: "2026-11-08T00:00:00.000Z", data: { id: "post_1" } });

function sign(raw: string, t: number, key = secret) {
  return `t=${t},v1=${createHmac("sha256", key).update(`${t}.${raw}`).digest("hex")}`;
}

const now = () => Math.floor(Date.now() / 1000);

test("accepts a valid signature", () => {
  assert.equal(verifyWebhookSignature(body, sign(body, now()), secret), true);
});

test("accepts a Buffer body", () => {
  assert.equal(verifyWebhookSignature(Buffer.from(body), sign(body, now()), secret), true);
});

test("rejects the wrong secret", () => {
  assert.equal(verifyWebhookSignature(body, sign(body, now(), "whsec_other"), secret), false);
});

test("rejects a tampered body", () => {
  assert.equal(verifyWebhookSignature(body.replace("post_1", "post_2"), sign(body, now()), secret), false);
});

test("rejects an expired timestamp and honours the tolerance", () => {
  const old = now() - 600;
  assert.equal(verifyWebhookSignature(body, sign(body, old), secret), false);
  assert.equal(verifyWebhookSignature(body, sign(body, old), secret, 900), true);
  assert.equal(verifyWebhookSignature(body, sign(body, old), secret, 0), true);
});

test("rejects malformed or missing headers", () => {
  assert.equal(verifyWebhookSignature(body, undefined, secret), false);
  assert.equal(verifyWebhookSignature(body, "", secret), false);
  assert.equal(verifyWebhookSignature(body, "garbage", secret), false);
  assert.equal(verifyWebhookSignature(body, `t=${now()}`, secret), false);
  assert.equal(verifyWebhookSignature(body, `v1=abc`, secret), false);
  assert.equal(verifyWebhookSignature(body, `t=abc,v1=abc`, secret), false);
  assert.equal(verifyWebhookSignature(body, `t=${now()},v1=short`, secret), false);
});

test("accepts when any of several v1 signatures matches", () => {
  const t = now();
  const good = sign(body, t).split(",")[1];
  assert.equal(verifyWebhookSignature(body, `t=${t},v1=${"0".repeat(64)},${good}`, secret), true);
});

test("constructWebhookEvent parses verified events and throws on bad ones", () => {
  const event = constructWebhookEvent(body, sign(body, now()), secret);
  assert.equal(event.event, "post.published");
  assert.throws(() => constructWebhookEvent(body, sign(body, now(), "nope"), secret), (err: unknown) => err instanceof FanoutError && err.code === "invalid_signature");
});
