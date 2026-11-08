import { z } from "zod";
import { apiRoute, json, readJson } from "@/lib/api";
import { db } from "@/lib/db";
import { serializeProfile } from "@/lib/serializers";

const schema = z.object({ name: z.string().min(1).max(100), description: z.string().max(500).optional() });

export const GET = apiRoute(async (_req, { user }) => {
  const profiles = await db.profile.findMany({
    where: { userId: user.id },
    include: { _count: { select: { accounts: true } } },
    orderBy: { createdAt: "asc" },
  });
  return json({ profiles: profiles.map(serializeProfile) });
});

export const POST = apiRoute(async (req, { user }) => {
  const body = schema.parse(await readJson(req));
  const profile = await db.profile.create({ data: { userId: user.id, name: body.name, description: body.description }, include: { _count: { select: { accounts: true } } } });
  return json({ profile: serializeProfile(profile) }, 201);
});
