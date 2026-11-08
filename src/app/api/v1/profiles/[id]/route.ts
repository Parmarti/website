import { z } from "zod";
import { ApiError, apiRoute, json, readJson } from "@/lib/api";
import { db } from "@/lib/db";
import { serializeProfile } from "@/lib/serializers";

const schema = z.object({ name: z.string().min(1).max(100).optional(), description: z.string().max(500).nullable().optional() });

async function load(userId: string, id: string) {
  const profile = await db.profile.findFirst({ where: { id, userId }, include: { _count: { select: { accounts: true } } } });
  if (!profile) throw new ApiError(404, "Profile not found.", "not_found");
  return profile;
}

export const GET = apiRoute<{ id: string }>(async (_req, { user, params }) => json({ profile: serializeProfile(await load(user.id, params.id)) }));

export const PATCH = apiRoute<{ id: string }>(async (req, { user, params }) => {
  await load(user.id, params.id);
  const body = schema.parse(await readJson(req));
  const profile = await db.profile.update({ where: { id: params.id }, data: body });
  return json({ profile: serializeProfile(profile) });
});

export const DELETE = apiRoute<{ id: string }>(async (_req, { user, params }) => {
  await load(user.id, params.id);
  await db.profile.delete({ where: { id: params.id } });
  return json({ deleted: true });
});
