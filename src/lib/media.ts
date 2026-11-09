import type { Media } from "@prisma/client";
import type { NextRequest } from "next/server";
import { db } from "./db";
import { ALLOWED_TYPES, UploadError, contentTypeFromFilename, limits, mediaUrl, newMediaId, removeMedia, safeFilename, saveUpload } from "./storage";

export function serializeMedia(m: Media) {
  return {
    id: m.id,
    url: mediaUrl(m.id, m.filename),
    type: ALLOWED_TYPES[m.contentType]?.kind ?? "image",
    filename: m.filename,
    contentType: m.contentType,
    size: m.size,
    createdAt: m.createdAt,
  };
}

/** Store an upload for a user: checks type, size and the user's storage quota. */
export async function createMedia(userId: string, input: { contentType: string; filename?: string | null; body: ReadableStream<Uint8Array>; declaredSize?: number }) {
  const contentType = input.contentType.split(";")[0].trim().toLowerCase();
  const info = ALLOWED_TYPES[contentType];
  if (!info) throw new UploadError(`Unsupported file type '${contentType || "unknown"}'. Upload JPEG, PNG, GIF, WebP, MP4, MOV or WebM.`, 415);
  const l = limits();
  const max = info.kind === "image" ? l.image : l.video;
  if (input.declaredSize && input.declaredSize > max) throw new UploadError(`File is too large. The limit is ${Math.round(max / 1024 / 1024)} MB.`, 413);
  const used = (await db.media.aggregate({ where: { userId }, _sum: { size: true } }))._sum.size ?? 0;
  const room = l.perUser - used;
  if (room <= 0) throw new UploadError("Your media storage is full. Delete old files to upload new ones.", 413);

  const id = newMediaId();
  const size = await saveUpload(id, contentType, input.body, Math.min(max, room));
  try {
    return await db.media.create({ data: { id, userId, filename: safeFilename(input.filename, contentType), contentType, size } });
  } catch (err) {
    await removeMedia(id);
    throw err;
  }
}

export async function deleteMedia(userId: string, id: string) {
  const { count } = await db.media.deleteMany({ where: { id, userId } });
  if (count) await removeMedia(id);
  return count > 0;
}

/** Remove every stored file of a user (used before the account is deleted). */
export async function deleteAllMedia(userId: string) {
  const items = await db.media.findMany({ where: { userId }, select: { id: true } });
  for (const m of items) await removeMedia(m.id);
}

/**
 * Upload a file. Either multipart/form-data with a "file" field,
 * or the raw bytes with the file's Content-Type and an optional ?filename=.
 */
export async function readUpload(req: NextRequest) {
  const type = req.headers.get("content-type") || "";
  if (type.startsWith("multipart/form-data")) {
    const form = await req.formData();
    const file = form.get("file");
    if (!(file instanceof File)) throw new UploadError("Send the file in a form field named 'file'.");
    return { contentType: file.type || contentTypeFromFilename(file.name), filename: file.name, body: file.stream(), declaredSize: file.size };
  }
  if (!req.body) throw new UploadError("The request has no body.");
  return {
    contentType: type && type !== "application/octet-stream" ? type : contentTypeFromFilename(req.nextUrl.searchParams.get("filename")),
    filename: req.nextUrl.searchParams.get("filename"),
    body: req.body,
    declaredSize: Number(req.headers.get("content-length")) || undefined,
  };
}

