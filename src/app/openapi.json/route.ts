import { NextResponse } from "next/server";
import { openApiDocument } from "@/lib/openapi";
import { appUrl } from "@/lib/env";

export const dynamic = "force-dynamic";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Cache-Control": "public, max-age=300",
};

export function GET() {
  return NextResponse.json(openApiDocument(appUrl()), { headers: corsHeaders });
}

export function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: corsHeaders });
}
