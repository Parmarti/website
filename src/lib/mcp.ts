/**
 * Minimal Model Context Protocol server (Streamable HTTP, stateless, JSON responses).
 * AI agents connect to /api/mcp with "Authorization: Bearer <API key>" and get tools to post on social media.
 */
import type { User } from "@prisma/client";
import { ZodError } from "zod";
import { db } from "./db";
import { brand } from "./brand";
import { getPlan } from "./plans";
import { platformList, isPlatformId, PLATFORM_IDS } from "./platforms";
import { sharedAppCredentials } from "./platform-apps";
import { createPost, cancelPost, retryPost, postsThisMonth, PostValidationError } from "./posts";
import { startConnect, LimitError } from "./accounts";
import { serializeAccount, serializePost, serializeProfile } from "./serializers";
import { getOverview, getPostAnalytics, parseRange } from "./analytics";

export const SUPPORTED_PROTOCOL_VERSIONS = ["2025-06-18", "2025-03-26", "2024-11-05"];

type JsonSchema = Record<string, unknown>;

interface Tool {
  name: string;
  title: string;
  description: string;
  inputSchema: JsonSchema;
  annotations?: { readOnlyHint?: boolean; destructiveHint?: boolean; idempotentHint?: boolean; openWorldHint?: boolean };
  run(user: User, args: Record<string, any>): Promise<unknown>;
}

const str = (description: string, extra: JsonSchema = {}) => ({ type: "string", description, ...extra });

export class ToolError extends Error {}

export interface McpContext {
  /** Called after a post is created so it can be published right away. */
  onPostCreated?: () => void;
}

function tools(ctx: McpContext): Tool[] {
  return [
    {
      name: "list_accounts",
      title: "List connected accounts",
      description: "List the social media accounts connected to this workspace. Use the returned `id` as accountId when creating posts.",
      inputSchema: {
        type: "object",
        properties: { platform: str("Only this platform", { enum: [...PLATFORM_IDS] }), profileId: str("Only accounts in this profile") },
      },
      annotations: { readOnlyHint: true },
      async run(user, a) {
        const accounts = await db.socialAccount.findMany({
          where: { userId: user.id, ...(a.platform ? { platform: a.platform } : {}), ...(a.profileId ? { profileId: a.profileId } : {}) },
          orderBy: { createdAt: "asc" },
        });
        return { accounts: accounts.map(serializeAccount) };
      },
    },
    {
      name: "create_post",
      title: "Create or schedule a post",
      description:
        "Publish now or schedule a post to one or more connected accounts. Media must be public URLs. Each network has its own limits (e.g. X 280 characters, Instagram/TikTok/YouTube need media); the tool returns per-account problems if the post does not fit. Use platformSpecificData for options such as YouTube title, Reddit subreddit/title or Pinterest boardId.",
      inputSchema: {
        type: "object",
        required: ["accounts"],
        properties: {
          content: str("Post text"),
          accounts: {
            type: "array",
            minItems: 1,
            description: "Target accounts",
            items: {
              type: "object",
              required: ["accountId"],
              properties: {
                accountId: str("Account id from list_accounts"),
                content: str("Different text for this account (optional)"),
                platformSpecificData: { type: "object", description: "Network options, see the API docs", additionalProperties: true },
              },
            },
          },
          mediaUrls: { type: "array", items: { type: "string" }, description: "Public image or video URLs" },
          scheduledFor: str("ISO date-time. Without an offset it is read in `timezone`. Omit to publish now."),
          timezone: str("IANA time zone, e.g. America/New_York (default UTC)"),
          isDraft: { type: "boolean", description: "Save without publishing" },
        },
      },
      annotations: { openWorldHint: true },
      async run(user, a) {
        const post = await createPost(
          user,
          {
            content: a.content ?? "",
            mediaItems: (a.mediaUrls ?? []).map((url: string) => ({ url })),
            platforms: a.accounts,
            ...(a.scheduledFor ? { scheduledFor: a.scheduledFor, timezone: a.timezone ?? "UTC" } : { publishNow: true }),
            isDraft: a.isDraft,
          },
          "api",
        );
        if (post.status === "scheduled" && post.scheduledFor <= new Date()) ctx.onPostCreated?.();
        return {
          post: serializePost(post),
          note: post.status === "draft" ? "Saved as draft." : post.scheduledFor > new Date() ? "Scheduled." : "Publishing now. Call get_post in a few seconds for the result.",
        };
      },
    },
    {
      name: "get_post",
      title: "Get a post",
      description: "Get a post with the result for each account (status, public URL or error).",
      inputSchema: { type: "object", required: ["postId"], properties: { postId: str("Post id") } },
      annotations: { readOnlyHint: true },
      async run(user, a) {
        const post = await db.post.findFirst({ where: { id: a.postId, userId: user.id }, include: { targets: true } });
        if (!post) throw new ToolError("Post not found.");
        return { post: serializePost(post) };
      },
    },
    {
      name: "list_posts",
      title: "List recent posts",
      description: "List recent posts, newest first.",
      inputSchema: {
        type: "object",
        properties: {
          status: str("Filter by status", { enum: ["draft", "scheduled", "publishing", "published", "partial", "failed", "cancelled"] }),
          limit: { type: "integer", minimum: 1, maximum: 50, description: "Default 10" },
        },
      },
      annotations: { readOnlyHint: true },
      async run(user, a) {
        const posts = await db.post.findMany({
          where: { userId: user.id, ...(a.status ? { status: a.status } : {}) },
          include: { targets: true },
          orderBy: { createdAt: "desc" },
          take: Math.min(Number(a.limit) || 10, 50),
        });
        return { posts: posts.map(serializePost) };
      },
    },
    {
      name: "cancel_post",
      title: "Cancel a scheduled post",
      description: "Cancel a scheduled post, or remove a finished post from history. It does not delete anything already published on a network.",
      inputSchema: { type: "object", required: ["postId"], properties: { postId: str("Post id") } },
      annotations: { destructiveHint: true, idempotentHint: true },
      async run(user, a) {
        const result = await cancelPost(user.id, a.postId);
        if (!result) throw new ToolError("Post not found.");
        return result;
      },
    },
    {
      name: "retry_post",
      title: "Retry failed networks",
      description: "Queue the failed accounts of a post again.",
      inputSchema: { type: "object", required: ["postId"], properties: { postId: str("Post id") } },
      annotations: { openWorldHint: true },
      async run(user, a) {
        const count = await retryPost(user.id, a.postId);
        if (count === null) throw new ToolError("Post not found.");
        if (count > 0) ctx.onPostCreated?.();
        return { requeued: count };
      },
    },
    {
      name: "get_connect_link",
      title: "Get a link to connect an account",
      description: "Get a one-time link (valid 30 minutes) that the user opens to connect a social account. Show the link to the user.",
      inputSchema: {
        type: "object",
        required: ["platform"],
        properties: { platform: str("Network", { enum: [...PLATFORM_IDS] }), profileId: str("Profile to add the account to (optional)") },
      },
      async run(user, a) {
        if (!isPlatformId(a.platform)) throw new ToolError(`Unknown platform '${a.platform}'.`);
        const url = await startConnect({ userId: user.id, platform: a.platform, profileId: a.profileId ?? null });
        return { url, expiresInMinutes: 30 };
      },
    },
    {
      name: "list_platforms",
      title: "List supported networks",
      description: "List the networks, whether they can be connected now, and their text and media limits.",
      inputSchema: { type: "object", properties: {} },
      annotations: { readOnlyHint: true },
      async run(user) {
        const own = new Set((await db.platformApp.findMany({ where: { userId: user.id }, select: { platform: true } })).map((p) => p.platform));
        return {
          platforms: platformList.map((p) => ({
            id: p.id,
            name: p.name,
            available: p.kind === "credentials" || own.has(p.id) || Boolean(sharedAppCredentials(p.id)),
            maxChars: p.maxChars ?? null,
            maxImages: p.maxImages,
            video: p.supportsVideo,
            mediaRequired: Boolean(p.requiresMedia),
          })),
        };
      },
    },
    {
      name: "get_analytics",
      title: "Get analytics overview",
      description:
        "Totals, per-network breakdown, daily engagements, top posts and follower changes for posts published in a period. Engagements = likes + comments + shares + saves + quotes; engagementRate = engagements / impressions (or views or reach).",
      inputSchema: {
        type: "object",
        properties: {
          days: { type: "integer", minimum: 1, maximum: 366, description: "Look back this many days (default 30)" },
          from: str("Start date, YYYY-MM-DD (overrides days)"),
          to: str("End date, YYYY-MM-DD (default today)"),
          platform: str("Only this network", { enum: [...PLATFORM_IDS] }),
          profileId: str("Only this profile"),
          accountId: str("Only this account"),
        },
      },
      annotations: { readOnlyHint: true },
      async run(user, a) {
        const range = parseRange({ days: a.days ? String(a.days) : undefined, from: a.from, to: a.to });
        const overview = await getOverview(user.id, { ...range, platform: a.platform ?? null, profileId: a.profileId ?? null, accountId: a.accountId ?? null });
        // Keep the answer compact for the model: drop empty days.
        return { ...overview, daily: overview.daily.filter((d) => d.posts > 0) };
      },
    },
    {
      name: "get_post_analytics",
      title: "Get analytics for one post",
      description: "Metrics for each network a post went to (views, likes, comments, shares...), with history and when they were last updated.",
      inputSchema: { type: "object", required: ["postId"], properties: { postId: str("Post id") } },
      annotations: { readOnlyHint: true },
      async run(user, a) {
        const result = await getPostAnalytics(user.id, a.postId);
        if (!result) throw new ToolError("Post not found.");
        return { ...result, platforms: result.platforms.map((p) => ({ ...p, history: p.history.slice(-10) })) };
      },
    },
    {
      name: "list_profiles",
      title: "List profiles",
      description: "List profiles (groups of accounts, usually one per client or brand).",
      inputSchema: { type: "object", properties: {} },
      annotations: { readOnlyHint: true },
      async run(user) {
        const profiles = await db.profile.findMany({ where: { userId: user.id }, include: { _count: { select: { accounts: true } } }, orderBy: { createdAt: "asc" } });
        return { profiles: profiles.map(serializeProfile) };
      },
    },
    {
      name: "get_usage",
      title: "Get plan usage",
      description: "Show the current plan, connected accounts and posts this month.",
      inputSchema: { type: "object", properties: {} },
      annotations: { readOnlyHint: true },
      async run(user) {
        const plan = getPlan(user.plan);
        const accounts = await db.socialAccount.count({ where: { userId: user.id } });
        return { plan: plan.name, accounts: { used: accounts, limit: plan.accounts }, postsThisMonth: { used: await postsThisMonth(user.id), limit: plan.postsPerMonth } };
      },
    },
  ];
}

interface RpcRequest {
  jsonrpc: "2.0";
  id?: string | number | null;
  method: string;
  params?: any;
}

const rpcResult = (id: RpcRequest["id"], result: unknown) => ({ jsonrpc: "2.0", id, result });
const rpcError = (id: RpcRequest["id"], code: number, message: string) => ({ jsonrpc: "2.0", id: id ?? null, error: { code, message } });

function toolErrorText(err: unknown): string {
  if (err instanceof PostValidationError) {
    const details = Array.isArray(err.details)
      ? (err.details as { platform?: string; accountId: string; errors: string[] }[]).map((d) => `- ${d.platform ?? d.accountId}: ${d.errors.join(" ")}`).join("\n")
      : "";
    return [err.message, details].filter(Boolean).join("\n");
  }
  if (err instanceof ZodError) return `Invalid arguments: ${err.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ")}`;
  if (err instanceof ToolError || err instanceof LimitError) return err.message;
  if (err instanceof Error && /not configured|Profile not found/.test(err.message)) return err.message;
  console.error("[mcp] tool failed", err);
  return "The tool failed because of an internal error.";
}

/** Handle one JSON-RPC message. Returns null for notifications. */
export async function handleRpc(user: User, msg: RpcRequest, ctx: McpContext): Promise<object | null> {
  const isNotification = msg.id === undefined;
  if (msg?.jsonrpc !== "2.0" || typeof msg.method !== "string") return rpcError(msg?.id, -32600, "Invalid request");
  if (isNotification) return null;

  switch (msg.method) {
    case "initialize": {
      const requested = msg.params?.protocolVersion;
      return rpcResult(msg.id, {
        protocolVersion: SUPPORTED_PROTOCOL_VERSIONS.includes(requested) ? requested : SUPPORTED_PROTOCOL_VERSIONS[0],
        capabilities: { tools: { listChanged: false } },
        serverInfo: { name: brand.name.toLowerCase(), title: brand.name, version: "1.0.0" },
        instructions: `Use these tools to publish and schedule social media posts with ${brand.name}. Call list_accounts first to get account ids. If the user has no accounts, call get_connect_link and show them the link.`,
      });
    }
    case "ping":
      return rpcResult(msg.id, {});
    case "tools/list":
      return rpcResult(msg.id, {
        tools: tools(ctx).map(({ run: _run, ...t }) => t),
      });
    case "tools/call": {
      const tool = tools(ctx).find((t) => t.name === msg.params?.name);
      if (!tool) return rpcError(msg.id, -32602, `Unknown tool: ${msg.params?.name}`);
      try {
        const output = await tool.run(user, msg.params?.arguments ?? {});
        return rpcResult(msg.id, { content: [{ type: "text", text: JSON.stringify(output, null, 2) }], structuredContent: output, isError: false });
      } catch (err) {
        return rpcResult(msg.id, { content: [{ type: "text", text: toolErrorText(err) }], isError: true });
      }
    }
    default:
      return rpcError(msg.id, -32601, `Method not found: ${msg.method}`);
  }
}
