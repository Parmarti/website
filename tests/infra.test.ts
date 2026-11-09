import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import fs from "node:fs/promises";
import { hit, checkApiLimit, resetRateLimits } from "../src/lib/rate-limit";

let dir = "";
let storage: typeof import("../src/lib/storage");

function streamOf(...chunks: Uint8Array[]) {
  return new ReadableStream<Uint8Array>({
    start(c) {
      for (const ch of chunks) c.enqueue(ch);
      c.close();
    },
  });
}

const PNG_HEAD = Buffer.from("89504e470d0a1a0a0000000d49484452", "hex");
const JPEG_HEAD = Buffer.from("ffd8ffe000104a464946000101000001", "hex");
const MP4_HEAD = Buffer.concat([Buffer.from([0, 0, 0, 0x18]), Buffer.from("ftypmp42"), Buffer.alloc(8)]);

describe("rate limiter", () => {
  before(() => resetRateLimits());
  it("allows up to the limit in a window, then blocks with a retry time", () => {
    const t0 = 1_000_000;
    for (let i = 0; i < 3; i++) assert.equal(hit("k", 3, 60_000, t0 + i).ok, true);
    const blocked = hit("k", 3, 60_000, t0 + 10);
    assert.equal(blocked.ok, false);
    assert.equal(blocked.remaining, 0);
    assert.equal(blocked.retryAfter, 60);
    assert.equal(hit("k", 3, 60_000, t0 + 60_001).ok, true, "the oldest hit left the window");
  });
  it("applies a tighter limit to writes than to reads", () => {
    resetRateLimits();
    process.env.RATE_LIMIT_PER_MINUTE = "10";
    process.env.RATE_LIMIT_WRITES_PER_MINUTE = "2";
    assert.equal(checkApiLimit("u1", "POST").ok, true);
    assert.equal(checkApiLimit("u1", "POST").ok, true);
    assert.equal(checkApiLimit("u1", "POST").ok, false);
    assert.equal(checkApiLimit("u1", "GET").ok, true, "reads still have room");
    delete process.env.RATE_LIMIT_PER_MINUTE;
    delete process.env.RATE_LIMIT_WRITES_PER_MINUTE;
  });
});

describe("media storage", () => {
  before(async () => {
    dir = await fs.mkdtemp(path.join(os.tmpdir(), "media-test-"));
    process.env.MEDIA_DIR = dir;
    storage = await import("../src/lib/storage");
  });
  after(() => fs.rm(dir, { recursive: true, force: true }));

  it("stores a file whose bytes match its type", async () => {
    const id = storage.newMediaId();
    const size = await storage.saveUpload(id, "image/png", streamOf(PNG_HEAD, new Uint8Array(100)), 1024);
    assert.equal(size, 116);
    assert.equal((await storage.statMedia(id))!.size, 116);
    await storage.removeMedia(id);
    assert.equal(await storage.statMedia(id), null);
  });

  it("rejects a file that lies about its type and leaves nothing behind", async () => {
    const id = storage.newMediaId();
    await assert.rejects(storage.saveUpload(id, "image/png", streamOf(Buffer.from("<html><script>alert(1)</script></html>")), 1024), /not a valid image\/png/);
    await assert.rejects(storage.saveUpload(storage.newMediaId(), "image/jpeg", streamOf(PNG_HEAD), 1024), /not a valid image\/jpeg/);
    assert.equal(await storage.statMedia(id), null);
  });

  it("accepts JPEG and MP4 signatures", async () => {
    const a = storage.newMediaId();
    const b = storage.newMediaId();
    await storage.saveUpload(a, "image/jpeg", streamOf(JPEG_HEAD), 1024);
    await storage.saveUpload(b, "video/mp4", streamOf(MP4_HEAD, new Uint8Array(50)), 1024);
    assert.ok(await storage.statMedia(a));
    assert.ok(await storage.statMedia(b));
  });

  it("stops at the size limit", async () => {
    const id = storage.newMediaId();
    await assert.rejects(storage.saveUpload(id, "image/png", streamOf(PNG_HEAD, new Uint8Array(2000)), 1024), /too large/);
    assert.equal(await storage.statMedia(id), null);
  });

  it("refuses types we do not serve (no HTML or SVG on our domain)", async () => {
    await assert.rejects(storage.saveUpload(storage.newMediaId(), "image/svg+xml", streamOf(Buffer.from("<svg/>")), 1024), /Unsupported file type/);
    await assert.rejects(storage.saveUpload(storage.newMediaId(), "text/html", streamOf(Buffer.from("<p>")), 1024), /Unsupported file type/);
  });

  it("makes safe file names and rejects bad ids", () => {
    assert.equal(storage.safeFilename("../../etc/passwd", "image/png"), "passwd.png");
    assert.equal(storage.safeFilename("My Photo (1).JPG", "image/jpeg"), "My-Photo-1.jpg");
    assert.equal(storage.safeFilename(null, "video/mp4"), "file.mp4");
    assert.throws(() => storage.openMedia("../../secret"), /Invalid media id/);
  });

  it("recognises our own media URLs", () => {
    const id = "abcdefghijklmnopqrstuvwx";
    assert.equal(storage.ownMediaId(storage.mediaUrl(id, "a.png")), id);
    assert.equal(storage.ownMediaId("https://elsewhere.test/media/" + id + "/a.png"), null);
  });
});
