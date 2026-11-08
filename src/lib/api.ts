import { NextRequest, NextResponse } from "next/server";
import { ZodError } from "zod";
import { db } from "./db";
import { sha256 } from "./crypto";
import type { User } from "@prisma/client";
import { PostValidationError } from "./posts";
import { LimitError } from "./accounts";

export class ApiError extends Error {
  constructor(public status: number, message: string, public code = "error", public details?: unknown) {
    super(message);
  }
}

export function json(data: unknown, status = 200) {
  return NextResponse.json(data, { status });
}

export async function authenticateApiKey(req: NextRequest): Promise<User> {
  const header = req.headers.get("authorization") || "";
  const token = header.toLowerCase().startsWith("bearer ") ? header.slice(7).trim() : req.headers.get("x-api-key")?.trim();
  if (!token) throw new ApiError(401, "Missing API key. Send it as 'Authorization: Bearer <key>'.", "unauthorized");
  const key = await db.apiKey.findUnique({ where: { keyHash: sha256(token) }, include: { user: true } });
  if (!key || key.revokedAt) throw new ApiError(401, "Invalid or revoked API key.", "unauthorized");
  if (!key.lastUsedAt || Date.now() - key.lastUsedAt.getTime() > 60_000) {
    await db.apiKey.update({ where: { id: key.id }, data: { lastUsedAt: new Date() } });
  }
  return key.user;
}

type Handler<C> = (req: NextRequest, ctx: { user: User; params: C }) => Promise<Response>;

/** Wrap a v1 API route: API key auth + uniform error responses. */
export function apiRoute<C = Record<string, string>>(handler: Handler<C>) {
  return async (req: NextRequest, context: { params: Promise<C> }) => {
    try {
      const user = await authenticateApiKey(req);
      const params = context?.params ? await context.params : ({} as C);
      return await handler(req, { user, params });
    } catch (err) {
      return errorResponse(err);
    }
  };
}

export function errorResponse(err: unknown) {
  if (err instanceof ApiError) {
    return json({ error: { code: err.code, message: err.message, details: err.details } }, err.status);
  }
  if (err instanceof PostValidationError) {
    return json({ error: { code: err.status === 402 ? "plan_limit" : "validation_error", message: err.message, details: err.details } }, err.status);
  }
  if (err instanceof LimitError) {
    return json({ error: { code: "plan_limit", message: err.message } }, 402);
  }
  if (err instanceof ZodError) {
    return json({ error: { code: "validation_error", message: "Invalid request body.", details: err.flatten() } }, 400);
  }
  console.error("[api] unhandled error", err);
  return json({ error: { code: "internal_error", message: "Something went wrong." } }, 500);
}

export async function readJson(req: NextRequest): Promise<unknown> {
  try {
    return await req.json();
  } catch {
    throw new ApiError(400, "Request body must be valid JSON.", "invalid_json");
  }
}
