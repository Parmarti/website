import { ApiError, apiRoute, json } from "@/lib/api";
import { db } from "@/lib/db";
import { deleteMedia, serializeMedia } from "@/lib/media";

export const GET = apiRoute<{ id: string }>(async (_req, { user, params }) => {
  const media = await db.media.findFirst({ where: { id: params.id, userId: user.id } });
  if (!media) throw new ApiError(404, "Media not found.", "not_found");
  return json({ media: serializeMedia(media) });
});

/** Deletes the stored file. Posts already published keep their copy on the networks. */
export const DELETE = apiRoute<{ id: string }>(async (_req, { user, params }) => {
  if (!(await deleteMedia(user.id, params.id))) throw new ApiError(404, "Media not found.", "not_found");
  return json({ deleted: true });
});
