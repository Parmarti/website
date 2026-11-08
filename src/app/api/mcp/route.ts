import { NextRequest, NextResponse, after } from "next/server";
import { ApiError, authenticateApiKey } from "@/lib/api";
import { handleRpc } from "@/lib/mcp";
import { processDuePosts } from "@/lib/publisher";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

/** MCP Streamable HTTP endpoint (stateless). Clients send JSON-RPC with Authorization: Bearer <API key>. */
export async function POST(req: NextRequest) {
  let user;
  try {
    user = await authenticateApiKey(req);
  } catch (err) {
    const message = err instanceof ApiError ? err.message : "Unauthorized";
    return NextResponse.json({ jsonrpc: "2.0", id: null, error: { code: -32001, message } }, { status: 401, headers: { "WWW-Authenticate": 'Bearer realm="mcp"' } });
  }

  let payload: unknown;
  try {
    payload = await req.json();
  } catch {
    return NextResponse.json({ jsonrpc: "2.0", id: null, error: { code: -32700, message: "Parse error" } }, { status: 400 });
  }

  let publishSoon = false;
  const ctx = { onPostCreated: () => (publishSoon = true) };
  const messages = Array.isArray(payload) ? payload : [payload];
  const replies = (await Promise.all(messages.map((m) => handleRpc(user, m as never, ctx)))).filter(Boolean);
  if (publishSoon) after(() => processDuePosts({ maxBatches: 2 }).catch((err) => console.error("[mcp] publish failed", err)));

  if (replies.length === 0) return new NextResponse(null, { status: 202 });
  return NextResponse.json(Array.isArray(payload) ? replies : replies[0]);
}

export function GET() {
  return NextResponse.json({ error: "This MCP server does not offer an SSE stream. Use POST." }, { status: 405, headers: { Allow: "POST" } });
}

export function DELETE() {
  return new NextResponse(null, { status: 405, headers: { Allow: "POST" } });
}
