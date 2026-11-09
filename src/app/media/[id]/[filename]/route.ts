import { NextRequest } from "next/server";
import { Readable } from "node:stream";
import { db } from "@/lib/db";
import { openMedia, statMedia } from "@/lib/storage";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Public file serving for uploaded media (networks fetch posts' media from here). Supports Range requests. */
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string; filename: string }> }) {
  const { id } = await params;
  if (!/^[A-Za-z0-9_-]{16,64}$/.test(id)) return new Response("Not found", { status: 404 });
  const media = await db.media.findUnique({ where: { id } });
  const stat = media ? await statMedia(id) : null;
  if (!media || !stat) return new Response("Not found", { status: 404 });

  const headers: Record<string, string> = {
    "Content-Type": media.contentType,
    "Accept-Ranges": "bytes",
    "Cache-Control": "public, max-age=31536000, immutable",
    "Content-Disposition": `inline; filename="${media.filename}"`,
    "X-Content-Type-Options": "nosniff",
    "Content-Security-Policy": "default-src 'none'; sandbox",
  };
  const range = /^bytes=(\d*)-(\d*)$/.exec(req.headers.get("range") || "");
  if (range && (range[1] || range[2])) {
    const size = stat.size;
    let start = range[1] ? Number(range[1]) : size - Number(range[2]);
    let end = range[1] && range[2] ? Number(range[2]) : size - 1;
    start = Math.max(0, start);
    end = Math.min(end, size - 1);
    if (start > end) return new Response(null, { status: 416, headers: { "Content-Range": `bytes */${size}` } });
    const body = Readable.toWeb(openMedia(id, { start, end })) as ReadableStream;
    return new Response(body, { status: 206, headers: { ...headers, "Content-Range": `bytes ${start}-${end}/${size}`, "Content-Length": String(end - start + 1) } });
  }
  const body = Readable.toWeb(openMedia(id)) as ReadableStream;
  return new Response(body, { status: 200, headers: { ...headers, "Content-Length": String(stat.size) } });
}

export async function HEAD(req: NextRequest, ctx: { params: Promise<{ id: string; filename: string }> }) {
  const res = await GET(req, ctx);
  return new Response(null, { status: res.status, headers: res.headers });
}
