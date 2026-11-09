import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { createMedia, readUpload, serializeMedia } from "@/lib/media";
import { UploadError } from "@/lib/storage";

export const runtime = "nodejs";
export const maxDuration = 300;

/** Upload from the dashboard composer (session cookie auth). */
export async function POST(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Not signed in." }, { status: 401 });
  try {
    const media = await createMedia(user.id, await readUpload(req));
    return NextResponse.json({ media: serializeMedia(media) }, { status: 201 });
  } catch (err) {
    if (err instanceof UploadError) return NextResponse.json({ error: err.message }, { status: err.status });
    console.error("[media] upload failed", err);
    return NextResponse.json({ error: "Upload failed." }, { status: 500 });
  }
}
