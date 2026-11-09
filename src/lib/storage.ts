/**
 * Media storage on local disk. On Railway, mount a volume and set MEDIA_DIR to a folder on it (e.g. /data/uploads).
 * Files are served publicly at /media/<id>/<filename> so social networks can fetch them.
 */
import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import { appUrl } from "./env";
import { randomToken } from "./crypto";

export const ALLOWED_TYPES: Record<string, { kind: "image" | "video"; ext: string }> = {
  "image/jpeg": { kind: "image", ext: "jpg" },
  "image/png": { kind: "image", ext: "png" },
  "image/gif": { kind: "image", ext: "gif" },
  "image/webp": { kind: "image", ext: "webp" },
  "video/mp4": { kind: "video", ext: "mp4" },
  "video/quicktime": { kind: "video", ext: "mov" },
  "video/webm": { kind: "video", ext: "webm" },
};

/** Map a file name extension to an allowed content type, or "" when unknown. */
export function contentTypeFromFilename(name: string | null | undefined): string {
  const ext = (name || "").split(".").pop()?.toLowerCase();
  if (ext === "jpeg") return "image/jpeg";
  return Object.entries(ALLOWED_TYPES).find(([, v]) => v.ext === ext)?.[0] ?? "";
}

export class UploadError extends Error {
  constructor(message: string, public status = 400) {
    super(message);
  }
}

const mb = (v: string | undefined, d: number) => (Number(v) > 0 ? Number(v) : d) * 1024 * 1024;
export const limits = () => ({
  image: mb(process.env.MAX_IMAGE_MB, 20),
  video: mb(process.env.MAX_VIDEO_MB, 512),
  perUser: mb(process.env.MEDIA_QUOTA_MB, 5120),
});

export function mediaDir() {
  return path.resolve(process.env.MEDIA_DIR || "./uploads");
}

export function newMediaId() {
  return randomToken(18); // 24 url-safe characters, not guessable
}

function fileFor(id: string) {
  if (!/^[A-Za-z0-9_-]{16,64}$/.test(id)) throw new UploadError("Invalid media id.", 404);
  return path.join(mediaDir(), id.slice(0, 2), id);
}

export function safeFilename(name: string | null | undefined, contentType: string) {
  const ext = ALLOWED_TYPES[contentType]?.ext ?? "bin";
  const base = (name || "")
    .split(/[\\/]/)
    .pop()!
    .replace(/\.[A-Za-z0-9]{1,5}$/, "")
    .replace(/[^A-Za-z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
  return `${base || "file"}.${ext}`;
}

export function mediaUrl(id: string, filename: string) {
  return `${appUrl()}/media/${id}/${encodeURIComponent(filename)}`;
}

/** Check the first bytes so a file can only be stored under the type it really is. */
function matchesType(head: Buffer, contentType: string): boolean {
  const hex = head.toString("hex");
  switch (contentType) {
    case "image/jpeg":
      return hex.startsWith("ffd8ff");
    case "image/png":
      return hex.startsWith("89504e470d0a1a0a");
    case "image/gif":
      return head.subarray(0, 4).toString("ascii") === "GIF8";
    case "image/webp":
      return head.subarray(0, 4).toString("ascii") === "RIFF" && head.subarray(8, 12).toString("ascii") === "WEBP";
    case "video/mp4":
    case "video/quicktime":
      return head.subarray(4, 8).toString("ascii") === "ftyp";
    case "video/webm":
      return hex.startsWith("1a45dfa3");
    default:
      return false;
  }
}

/** Stream an upload to disk, enforcing the size cap and the real file type. Returns the byte count. */
export async function saveUpload(id: string, contentType: string, body: ReadableStream<Uint8Array>, maxBytes: number): Promise<number> {
  if (!ALLOWED_TYPES[contentType]) {
    throw new UploadError(`Unsupported file type '${contentType}'. Upload JPEG, PNG, GIF, WebP, MP4, MOV or WebM.`, 415);
  }
  const target = fileFor(id);
  await fsp.mkdir(path.dirname(target), { recursive: true });
  const temp = `${target}.part`;
  const out = fs.createWriteStream(temp, { flags: "wx" });
  let size = 0;
  let head = Buffer.alloc(0);
  try {
    const reader = body.getReader();
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > maxBytes) {
        await reader.cancel().catch(() => {});
        throw new UploadError(`File is too large. The limit is ${Math.round(maxBytes / 1024 / 1024)} MB.`, 413);
      }
      if (head.length < 16) head = Buffer.concat([head, Buffer.from(value.subarray(0, 16 - head.length))]);
      if (!out.write(value)) await new Promise<void>((r) => out.once("drain", () => r()));
    }
    await new Promise<void>((resolve, reject) => out.end((err?: Error | null) => (err ? reject(err) : resolve())));
    if (size === 0) throw new UploadError("The file is empty.");
    if (!matchesType(head, contentType)) throw new UploadError(`The file content is not a valid ${contentType} file.`, 415);
    await fsp.rename(temp, target);
    return size;
  } catch (err) {
    out.destroy();
    await fsp.rm(temp, { force: true }).catch(() => {});
    throw err;
  }
}

export async function statMedia(id: string) {
  try {
    return await fsp.stat(fileFor(id));
  } catch {
    return null;
  }
}

export function openMedia(id: string, range?: { start: number; end: number }) {
  return fs.createReadStream(fileFor(id), range);
}

export async function readMedia(id: string) {
  return fsp.readFile(fileFor(id));
}

export async function removeMedia(id: string) {
  await fsp.rm(fileFor(id), { force: true }).catch(() => {});
}

/** Parse "/media/<id>/<name>" on our own domain; returns the id or null. */
export function ownMediaId(url: string): string | null {
  const prefix = `${appUrl()}/media/`;
  if (!url.startsWith(prefix)) return null;
  const id = url.slice(prefix.length).split("/")[0];
  return /^[A-Za-z0-9_-]{16,64}$/.test(id) ? id : null;
}
