import { ApiError, apiRoute, json } from "@/lib/api";
import { db } from "@/lib/db";
import { createMedia, readUpload, serializeMedia } from "@/lib/media";
import { UploadError } from "@/lib/storage";

export const runtime = "nodejs";
export const maxDuration = 300;

export const POST = apiRoute(async (req, { user }) => {
  try {
    const media = await createMedia(user.id, await readUpload(req));
    return json({ media: serializeMedia(media) }, 201);
  } catch (err) {
    if (err instanceof UploadError) throw new ApiError(err.status, err.message, err.status === 413 ? "too_large" : err.status === 415 ? "unsupported_type" : "invalid_upload");
    throw err;
  }
});

export const GET = apiRoute(async (req, { user }) => {
  const limit = Math.min(Number(req.nextUrl.searchParams.get("limit")) || 50, 100);
  const cursor = req.nextUrl.searchParams.get("cursor");
  const items = await db.media.findMany({
    where: { userId: user.id },
    orderBy: { createdAt: "desc" },
    take: limit + 1,
    ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
  });
  const page = items.slice(0, limit);
  return json({ media: page.map(serializeMedia), nextCursor: items.length > limit ? page[page.length - 1].id : null });
});
