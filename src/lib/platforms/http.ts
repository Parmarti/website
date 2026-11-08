import { assertPublicUrl } from "../net";

export class PlatformError extends Error {
  constructor(
    message: string,
    public opts: { retryable?: boolean; auth?: boolean; status?: number; body?: unknown } = {},
  ) {
    super(message);
  }
}

function summarize(body: unknown): string {
  if (body == null) return "";
  if (typeof body === "string") return body.slice(0, 500);
  try {
    return JSON.stringify(body).slice(0, 500);
  } catch {
    return String(body);
  }
}

/** Fetch and parse JSON. Throws PlatformError with a useful message on non-2xx. */
export async function fetchJson<T = any>(url: string, init: RequestInit & { label?: string } = {}): Promise<T> {
  const { label, ...rest } = init;
  let res: Response;
  try {
    res = await fetch(url, { ...rest, signal: rest.signal ?? AbortSignal.timeout(60_000) });
  } catch (err) {
    throw new PlatformError(`${label ?? "Request"} failed: ${(err as Error).message}`, { retryable: true });
  }
  const text = await res.text();
  let body: any = text;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    /* keep text */
  }
  if (!res.ok) {
    throw new PlatformError(`${label ?? "Request"} failed (${res.status}): ${summarize(body)}`, {
      status: res.status,
      body,
      retryable: res.status === 429 || res.status >= 500,
      auth: res.status === 401,
    });
  }
  return body as T;
}

export function form(data: Record<string, string | undefined | null>): URLSearchParams {
  const params = new URLSearchParams();
  for (const [k, v] of Object.entries(data)) if (v != null) params.set(k, v);
  return params;
}

export function basicAuth(id: string, secret: string): string {
  return "Basic " + Buffer.from(`${id}:${secret}`).toString("base64");
}

export function expiresIn(seconds: number | string | undefined | null): Date | null {
  const n = Number(seconds);
  return Number.isFinite(n) && n > 0 ? new Date(Date.now() + n * 1000) : null;
}

export interface DownloadedMedia {
  buffer: Buffer;
  contentType: string;
  size: number;
  filename: string;
}

/** Download user supplied media (public URLs only) with a size cap. */
export async function downloadMedia(url: string, maxBytes = 512 * 1024 * 1024): Promise<DownloadedMedia> {
  const parsed = await assertPublicUrl(url);
  let res: Response;
  try {
    res = await fetch(parsed, { signal: AbortSignal.timeout(120_000) });
  } catch (err) {
    throw new PlatformError(`Could not download media ${url}: ${(err as Error).message}`, { retryable: true });
  }
  if (!res.ok) throw new PlatformError(`Could not download media ${url} (${res.status})`, { retryable: res.status >= 500 });
  const declared = Number(res.headers.get("content-length") || 0);
  if (declared > maxBytes) throw new PlatformError(`Media is too large (${declared} bytes, limit ${maxBytes})`);
  const buffer = Buffer.from(await res.arrayBuffer());
  if (buffer.length > maxBytes) throw new PlatformError(`Media is too large (${buffer.length} bytes, limit ${maxBytes})`);
  const contentType = (res.headers.get("content-type") || guessType(parsed.pathname)).split(";")[0].trim();
  const filename = parsed.pathname.split("/").pop() || "media";
  return { buffer, contentType, size: buffer.length, filename };
}

function guessType(path: string): string {
  const ext = path.split(".").pop()?.toLowerCase();
  const map: Record<string, string> = {
    jpg: "image/jpeg", jpeg: "image/jpeg", png: "image/png", gif: "image/gif", webp: "image/webp",
    mp4: "video/mp4", mov: "video/quicktime", webm: "video/webm",
  };
  return (ext && map[ext]) || "application/octet-stream";
}

export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export function str(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

export function bool(value: unknown): boolean | undefined {
  return typeof value === "boolean" ? value : undefined;
}

/** Count user-perceived characters (grapheme clusters). */
export function graphemeLength(text: string): number {
  const Seg = (Intl as any).Segmenter;
  if (!Seg) return [...text].length;
  let n = 0;
  for (const _ of new Seg(undefined, { granularity: "grapheme" }).segment(text)) n++;
  return n;
}
