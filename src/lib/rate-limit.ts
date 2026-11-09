/**
 * Small in-memory sliding-window rate limiter.
 * It counts per server process, which is right for the single-instance deploy in LAUNCH.md.
 * With several instances, each one enforces the limit on its own.
 */
const buckets = new Map<string, number[]>();
let lastSweep = Date.now();

export interface RateResult {
  ok: boolean;
  limit: number;
  remaining: number;
  /** Seconds until a request is allowed again (0 when ok). */
  retryAfter: number;
  /** Unix seconds when the window resets. */
  reset: number;
}

export function hit(key: string, limit: number, windowMs: number, now = Date.now()): RateResult {
  if (now - lastSweep > 60_000) sweep(now, windowMs);
  const from = now - windowMs;
  const times = (buckets.get(key) ?? []).filter((t) => t > from);
  if (times.length >= limit) {
    buckets.set(key, times);
    const retryAfter = Math.max(1, Math.ceil((times[0] + windowMs - now) / 1000));
    return { ok: false, limit, remaining: 0, retryAfter, reset: Math.ceil((times[0] + windowMs) / 1000) };
  }
  times.push(now);
  buckets.set(key, times);
  return { ok: true, limit, remaining: limit - times.length, retryAfter: 0, reset: Math.ceil((times[0] + windowMs) / 1000) };
}

function sweep(now: number, windowMs: number) {
  lastSweep = now;
  for (const [key, times] of buckets) {
    if (!times.length || times[times.length - 1] < now - Math.max(windowMs, 15 * 60_000)) buckets.delete(key);
  }
}

export function resetRateLimits() {
  buckets.clear();
}

const num = (v: string | undefined, d: number) => (Number(v) > 0 ? Number(v) : d);

/** API limits per user: all requests, and a tighter limit for writes. */
export function apiLimits() {
  return {
    perMinute: num(process.env.RATE_LIMIT_PER_MINUTE, 300),
    writesPerMinute: num(process.env.RATE_LIMIT_WRITES_PER_MINUTE, 60),
  };
}

export function rateHeaders(r: RateResult): Record<string, string> {
  return {
    "X-RateLimit-Limit": String(r.limit),
    "X-RateLimit-Remaining": String(r.remaining),
    "X-RateLimit-Reset": String(r.reset),
    ...(r.ok ? {} : { "Retry-After": String(r.retryAfter) }),
  };
}

/** Check both API limits for a user and request method. Returns the result that applies. */
export function checkApiLimit(userId: string, method: string): RateResult {
  const { perMinute, writesPerMinute } = apiLimits();
  const all = hit(`api:${userId}`, perMinute, 60_000);
  if (!all.ok || method === "GET" || method === "HEAD") return all;
  const writes = hit(`api-w:${userId}`, writesPerMinute, 60_000);
  return writes.ok ? (writes.remaining < all.remaining ? writes : all) : writes;
}
