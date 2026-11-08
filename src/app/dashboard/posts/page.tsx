import { requireUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { Badge, Button, Card, PageHeader, statusTone } from "@/components/ui";
import { PlatformIcon } from "@/components/platform-icon";
import { compact } from "@/components/charts/format";
import { engagementsOf } from "@/lib/analytics";
import type { PostMetrics } from "@/lib/platforms";

function metricsLine(m: PostMetrics | null) {
  if (!m) return null;
  const parts: string[] = [];
  const views = m.impressions ?? m.views ?? m.reach;
  if (views !== null && views !== undefined) parts.push(`${compact(views)} ${m.impressions != null ? "impressions" : m.views != null ? "views" : "reach"}`);
  parts.push(`${compact(engagementsOf(m))} engagements`);
  return parts.join(" · ");
}
import { cancelPostAction, retryPostAction } from "../actions";
import { Composer, type ComposerAccount } from "../forms";

export default async function PostsPage() {
  const user = await requireUser();
  const [accounts, profiles, posts] = await Promise.all([
    db.socialAccount.findMany({ where: { userId: user.id }, orderBy: { createdAt: "asc" } }),
    db.profile.findMany({ where: { userId: user.id } }),
    db.post.findMany({ where: { userId: user.id }, include: { targets: true }, orderBy: { createdAt: "desc" }, take: 50 }),
  ]);
  const profileName = new Map(profiles.map((p) => [p.id, p.name]));
  const composerAccounts: ComposerAccount[] = accounts.map((a) => ({
    id: a.id,
    platform: a.platform,
    label: `${a.displayName || a.username}${profiles.length > 1 ? ` · ${profileName.get(a.profileId)}` : ""}`,
    profile: a.profileId,
    status: a.status,
    boards: a.platform === "pinterest" ? ((a.metadata as { boards?: { id: string; name: string }[] })?.boards ?? []) : undefined,
  }));

  return (
    <div className="space-y-6">
      <PageHeader title="Posts" description="Compose here, or send posts through the API. Both land in the same queue." />
      <Card className="p-5">
        <Composer accounts={composerAccounts} />
      </Card>
      <Card>
        {posts.length === 0 ? (
          <p className="p-5 text-sm text-muted">No posts yet.</p>
        ) : (
          <ul className="divide-y divide-line">
            {posts.map((post) => (
              <li key={post.id} className="space-y-2 p-4">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div className="min-w-0 flex-1">
                    <p className="line-clamp-2 whitespace-pre-wrap text-sm">{post.content || <span className="text-muted">(media only)</span>}</p>
                    <p className="mt-1 text-xs text-muted">
                      {post.status === "scheduled" ? "Scheduled for " : "Created "}
                      {(post.status === "scheduled" ? post.scheduledFor : post.createdAt).toLocaleString("en-US", { timeZone: post.timezone })} ({post.timezone}) · via {post.source}
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    <Badge tone={statusTone(post.status)}>{post.status}</Badge>
                    {["failed", "partial"].includes(post.status) ? (
                      <form action={retryPostAction}>
                        <input type="hidden" name="id" value={post.id} />
                        <Button variant="secondary" size="sm">Retry failed</Button>
                      </form>
                    ) : null}
                    <form action={cancelPostAction}>
                      <input type="hidden" name="id" value={post.id} />
                      <Button variant="ghost" size="sm">{["scheduled", "draft", "publishing"].includes(post.status) ? "Cancel" : "Delete"}</Button>
                    </form>
                  </div>
                </div>
                <ul className="flex flex-wrap gap-2">
                  {post.targets.map((t) => (
                    <li key={t.id} className="flex max-w-full items-center gap-2 rounded-lg border border-line bg-wash px-2 py-1 text-xs">
                      <PlatformIcon platform={t.platform} size={18} />
                      <Badge tone={statusTone(t.status)}>{t.status}</Badge>
                      {t.platformPostUrl ? <a className="text-brand" href={t.platformPostUrl} target="_blank" rel="noreferrer">View</a> : null}
                      {t.metrics ? <span className="text-ink-2">{metricsLine(t.metrics as PostMetrics)}</span> : null}
                      {t.error ? <span className="truncate text-bad" title={t.error}>{t.error.slice(0, 120)}</span> : null}
                    </li>
                  ))}
                </ul>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}
