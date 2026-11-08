// Test helpers: a fetch replacement that routes requests to handlers and records every call.
process.env.ALLOW_PRIVATE_URLS = "1";

export interface Call {
  method: string;
  url: string;
  headers: Record<string, string>;
  body: unknown; // string | Uint8Array | FormData | undefined
  text: string; // body as text when it is text, else ""
  json: any; // parsed JSON when the body is JSON
  form: URLSearchParams | null; // parsed when the body is URL encoded
}

type Handler = (call: Call) => Response | Promise<Response> | unknown;

interface Route {
  method: string;
  match: string | RegExp;
  handler: Handler;
  times?: number;
}

export function json(body: unknown, status = 200, headers: Record<string, string> = {}) {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", ...headers } });
}

export function bytes(size: number, contentType: string) {
  return new Response(new Uint8Array(size), { status: 200, headers: { "content-type": contentType, "content-length": String(size) } });
}

/** String routes match the exact path (query ignored). If the string has a "?", the URL must start with it. */
export function urlMatches(url: string, match: string | RegExp): boolean {
  if (typeof match !== "string") return match.test(url);
  return match.includes("?") ? url.startsWith(match) : url.split("?")[0] === match;
}

export class MockNet {
  calls: Call[] = [];
  private routes: Route[] = [];
  private original = globalThis.fetch;

  on(method: string, match: string | RegExp, handler: Handler, times?: number) {
    this.routes.push({ method: method.toUpperCase(), match, handler, times });
    return this;
  }

  /** Media served at https://media.test/... */
  media() {
    this.on("GET", "https://media.test/photo.jpg", () => bytes(2048, "image/jpeg"));
    this.on("GET", "https://media.test/photo2.jpg", () => bytes(2048, "image/jpeg"));
    this.on("GET", "https://media.test/big.jpg", () => bytes(1_500_000, "image/jpeg"));
    this.on("GET", "https://media.test/anim.gif", () => bytes(4096, "image/gif"));
    this.on("GET", "https://media.test/clip.mp4", () => bytes(9 * 1024 * 1024, "video/mp4"));
    this.on("GET", "https://media.test/long.mp4", () => bytes(70_000_123, "video/mp4"));
    return this;
  }

  install() {
    globalThis.fetch = (async (input: RequestInfo | URL, init: RequestInit = {}) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
      const method = (init.method || "GET").toUpperCase();
      const headers: Record<string, string> = {};
      new Headers(init.headers).forEach((v, k) => (headers[k] = v));
      const body = init.body as unknown;
      let text = "";
      if (typeof body === "string") text = body;
      else if (body instanceof URLSearchParams) text = body.toString();
      let parsed: any = null;
      try {
        parsed = text ? JSON.parse(text) : null;
      } catch {
        /* not JSON */
      }
      const formBody = body instanceof URLSearchParams ? body : null;
      const call: Call = { method, url, headers, body, text, json: parsed, form: formBody };
      this.calls.push(call);

      const idx = this.routes.findIndex(
        (r) => r.method === method && urlMatches(url, r.match) && (r.times === undefined || r.times > 0),
      );
      if (idx === -1) throw new Error(`MockNet: no route for ${method} ${url}`);
      const route = this.routes[idx];
      if (route.times !== undefined) route.times--;
      const out = await route.handler(call);
      return out instanceof Response ? out : json(out ?? {});
    }) as typeof fetch;
    return this;
  }

  restore() {
    globalThis.fetch = this.original;
  }

  find(method: string, match: string | RegExp): Call[] {
    return this.calls.filter((c) => c.method === method && urlMatches(c.url, match));
  }

  one(method: string, match: string | RegExp): Call {
    const found = this.find(method, match);
    if (found.length !== 1) throw new Error(`Expected 1 call to ${method} ${match}, got ${found.length}:\n${this.calls.map((c) => `${c.method} ${c.url}`).join("\n")}`);
    return found[0];
  }
}

export const APP = { clientId: "client-id", clientSecret: "client-secret" };

export function ctx(overrides: Partial<import("../src/lib/platforms/types").PublishContext> = {}): import("../src/lib/platforms/types").PublishContext {
  return {
    account: { id: "acc_1", platformAccountId: "PID", username: "tester", metadata: {} },
    accessToken: "ACCESS",
    credentials: null,
    app: APP,
    content: "Hello world",
    media: [],
    options: {},
    ...overrides,
  };
}

export async function formDataEntries(body: unknown): Promise<Record<string, string>> {
  const out: Record<string, string> = {};
  if (body instanceof FormData) {
    for (const [k, v] of body.entries()) out[k] = typeof v === "string" ? v : `<blob ${(v as Blob).size}>`;
  }
  return out;
}
