import type { CredentialAdapter, MediaItem } from "./types";
import { PlatformError, downloadMedia, fetchJson, graphemeLength, str } from "./http";
import { assertPublicUrl } from "../net";

const DEFAULT_SERVICE = "https://bsky.social";
const MAX_IMAGE_BYTES = 1_000_000;

interface Session {
  accessJwt: string;
  did: string;
  handle: string;
}

async function createSession(service: string, identifier: string, password: string): Promise<Session> {
  try {
    return await fetchJson<Session>(`${service}/xrpc/com.atproto.server.createSession`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ identifier, password }),
      label: "Bluesky login",
    });
  } catch (err) {
    if (err instanceof PlatformError && (err.opts.status === 401 || err.opts.status === 400)) {
      throw new PlatformError("Bluesky rejected the handle or app password. Create a new app password and reconnect.", { auth: true });
    }
    throw err;
  }
}

function utf8Index(text: string, charIndex: number) {
  return Buffer.byteLength(text.slice(0, charIndex), "utf8");
}

const TRAILING_PUNCT = /[.,;:!?)\]}'"]+$/;

/** Build rich text facets for links, hashtags and mentions (byte offsets in UTF-8). */
async function buildFacets(text: string, service: string) {
  const facets: any[] = [];
  for (const m of text.matchAll(/https?:\/\/[^\s]+/g)) {
    const uri = m[0].replace(TRAILING_PUNCT, "");
    const start = m.index!;
    facets.push({
      index: { byteStart: utf8Index(text, start), byteEnd: utf8Index(text, start + uri.length) },
      features: [{ $type: "app.bsky.richtext.facet#link", uri }],
    });
  }
  for (const m of text.matchAll(/(^|\s)#([^\d\s#][^\s#]*)/g)) {
    const tag = m[2].replace(TRAILING_PUNCT, "");
    const start = m.index! + m[1].length;
    facets.push({
      index: { byteStart: utf8Index(text, start), byteEnd: utf8Index(text, start + tag.length + 1) },
      features: [{ $type: "app.bsky.richtext.facet#tag", tag }],
    });
  }
  for (const m of text.matchAll(/(^|\s)@([a-zA-Z0-9-]+(?:\.[a-zA-Z0-9-]+)+)/g)) {
    const handle = m[2].replace(TRAILING_PUNCT, "");
    const start = m.index! + m[1].length;
    try {
      const { did } = await fetchJson<{ did: string }>(
        `${service}/xrpc/com.atproto.identity.resolveHandle?handle=${encodeURIComponent(handle)}`,
      );
      facets.push({
        index: { byteStart: utf8Index(text, start), byteEnd: utf8Index(text, start + handle.length + 1) },
        features: [{ $type: "app.bsky.richtext.facet#mention", did }],
      });
    } catch {
      /* unknown handle: leave as plain text */
    }
  }
  return facets;
}

async function uploadImage(service: string, session: Session, item: MediaItem) {
  const media = await downloadMedia(item.url, 20 * 1024 * 1024);
  if (media.size > MAX_IMAGE_BYTES) {
    throw new PlatformError(`Bluesky images must be 1 MB or smaller (got ${(media.size / 1e6).toFixed(1)} MB): ${item.url}`);
  }
  const res = await fetchJson<{ blob: unknown }>(`${service}/xrpc/com.atproto.repo.uploadBlob`, {
    method: "POST",
    headers: { Authorization: `Bearer ${session.accessJwt}`, "Content-Type": media.contentType },
    body: new Uint8Array(media.buffer),
    label: "Bluesky image upload",
  });
  return { alt: item.altText ?? "", image: res.blob };
}

export const blueskyAdapter: CredentialAdapter = {
  id: "bluesky",
  name: "Bluesky",
  kind: "credentials",
  maxChars: 300,
  maxImages: 4,
  supportsVideo: false,
  supportsText: true,
  helpText: "Use an app password, not your main password. Create one in Bluesky under Settings > Privacy and security > App passwords.",
  fields: [
    { name: "handle", label: "Handle", type: "text", placeholder: "yourname.bsky.social" },
    { name: "appPassword", label: "App password", type: "password", placeholder: "xxxx-xxxx-xxxx-xxxx" },
    { name: "service", label: "PDS URL (optional)", type: "url", placeholder: DEFAULT_SERVICE, optional: true },
  ],
  validate({ content, media }) {
    const problems: string[] = [];
    if (graphemeLength(content) > 300) problems.push("Bluesky posts are limited to 300 characters.");
    if (media.some((m) => m.type === "video")) problems.push("Video is not supported for Bluesky yet.");
    if (media.length > 4) problems.push("Bluesky allows at most 4 images.");
    return problems;
  },
  async verify(fields) {
    const handle = fields.handle?.trim().replace(/^@/, "");
    const password = fields.appPassword?.trim();
    if (!handle || !password) throw new PlatformError("Handle and app password are required.");
    const service = (fields.service?.trim() || DEFAULT_SERVICE).replace(/\/$/, "");
    if (service !== DEFAULT_SERVICE) await assertPublicUrl(service);
    const session = await createSession(service, handle, password);
    let profile: any = {};
    try {
      profile = await fetchJson(`${service}/xrpc/app.bsky.actor.getProfile?actor=${encodeURIComponent(session.did)}`, {
        headers: { Authorization: `Bearer ${session.accessJwt}` },
      });
    } catch {
      /* profile is cosmetic */
    }
    return {
      identity: {
        platformAccountId: session.did,
        username: session.handle,
        displayName: profile.displayName || session.handle,
        avatarUrl: profile.avatar ?? null,
        metadata: { service },
      },
      credentials: { identifier: session.handle, password, service },
    };
  },
  async publish(ctx) {
    const creds = ctx.credentials;
    if (!creds?.identifier || !creds.password) throw new PlatformError("Missing Bluesky credentials. Reconnect the account.", { auth: true });
    const service = creds.service || DEFAULT_SERVICE;
    const session = await createSession(service, creds.identifier, creds.password);

    const record: Record<string, unknown> = {
      $type: "app.bsky.feed.post",
      text: ctx.content,
      createdAt: new Date().toISOString(),
      langs: Array.isArray(ctx.options.langs) ? ctx.options.langs : undefined,
    };
    const facets = await buildFacets(ctx.content, service);
    if (facets.length) record.facets = facets;

    const images = ctx.media.filter((m) => m.type === "image").slice(0, 4);
    if (images.length) {
      record.embed = {
        $type: "app.bsky.embed.images",
        images: await Promise.all(images.map((img) => uploadImage(service, session, img))),
      };
    }

    const replyTo = str(ctx.options.replyToUri);
    if (replyTo) {
      const parent = await fetchJson<{ uri: string; cid: string; value: any }>(
        `${service}/xrpc/com.atproto.repo.getRecord?${new URLSearchParams({
          repo: replyTo.split("/")[2],
          collection: "app.bsky.feed.post",
          rkey: replyTo.split("/").pop()!,
        })}`,
      );
      const root = parent.value?.reply?.root ?? { uri: parent.uri, cid: parent.cid };
      record.reply = { root, parent: { uri: parent.uri, cid: parent.cid } };
    }

    const res = await fetchJson<{ uri: string; cid: string }>(`${service}/xrpc/com.atproto.repo.createRecord`, {
      method: "POST",
      headers: { Authorization: `Bearer ${session.accessJwt}`, "Content-Type": "application/json" },
      body: JSON.stringify({ repo: session.did, collection: "app.bsky.feed.post", record }),
      label: "Bluesky post",
    });
    const rkey = res.uri.split("/").pop();
    return { platformPostId: res.uri, url: `https://bsky.app/profile/${session.handle}/post/${rkey}` };
  },
};
