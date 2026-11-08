import { NextRequest, NextResponse } from "next/server";
import { schedulerTick } from "@/lib/publisher";
import { timingSafeEqual } from "@/lib/crypto";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

/** Call every minute (Vercel Cron, cron-job.org, etc.) with Authorization: Bearer $CRON_SECRET. */
export async function GET(req: NextRequest) {
  const secret = process.env.CRON_SECRET;
  const given = req.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ?? req.nextUrl.searchParams.get("secret") ?? "";
  if (!secret || !timingSafeEqual(given, secret)) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const result = await schedulerTick();
  return NextResponse.json({ ok: true, ...result });
}
