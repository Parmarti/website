import Link from "next/link";
import { requireUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { getOverview, parseRange } from "@/lib/analytics";
import { getAdapter, platformList } from "@/lib/platforms";
import { Alert, Card, PageHeader } from "@/components/ui";
import { PlatformIcon } from "@/components/platform-icon";
import { ColumnChart } from "@/components/charts/column-chart";
import { RankedBars } from "@/components/charts/ranked-bars";
import { Sparkline } from "@/components/charts/sparkline";
import { compact, full, percent, shortDate } from "@/components/charts/format";
import { FilterBar } from "./filter-bar";

export const metadata = { title: "Analytics" };

function Stat({ label, value, sub }: { label: string; value: string; sub?: React.ReactNode }) {
  return (
    <Card className="p-4">
      <div className="text-sm text-muted">{label}</div>
      <div className="mt-1 text-2xl font-semibold text-ink">{value}</div>
      {sub ? <div className="mt-0.5 text-xs text-muted">{sub}</div> : null}
    </Card>
  );
}

function Delta({ value }: { value: number | null }) {
  if (value === null) return <span>No change data yet</span>;
  if (value === 0) return <span>No change in this period</span>;
  const up = value > 0;
  return (
    <span className={up ? "text-[#006300]" : "text-bad"}>
      {up ? "▲" : "▼"} {up ? "+" : "−"}
      {full(Math.abs(value))} in this period
    </span>
  );
}

export default async function AnalyticsPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const user = await requireUser();
  const sp = await searchParams;
  const days = ["7", "30", "90"].includes(sp.days ?? "") ? sp.days! : "30";
  const { from, to } = parseRange({ days });
  const [overview, profiles] = await Promise.all([
    getOverview(user.id, { from, to, platform: sp.platform || null, profileId: sp.profileId || null }),
    db.profile.findMany({ where: { userId: user.id }, select: { id: true, name: true }, orderBy: { createdAt: "asc" } }),
  ]);
  const { totals, coverage } = overview;
  const audience = totals.audience;
  const audienceLabel = "Views and impressions";
  const followers = overview.accounts.reduce((sum, a) => sum + (a.followers ?? 0), 0);
  const followerChanges = overview.accounts.filter((a) => a.followersChange !== null);
  const followersChange = followerChanges.length ? followerChanges.reduce((s, a) => s + (a.followersChange ?? 0), 0) : null;
  const names = new Map(platformList.map((p) => [p.id as string, p.name]));
  const pending = coverage.posts - coverage.withMetrics;
  const unsupported = [...new Set(overview.byPlatform.map((p) => p.platform))].filter((p) => !getAdapter(p)?.analytics?.fetchPostMetrics);

  return (
    <div className="space-y-6">
      <PageHeader title="Analytics" description={`Posts published ${shortDate(from.toISOString().slice(0, 10))} to ${shortDate(to.toISOString().slice(0, 10))}. Dates are in UTC.`} />
      <FilterBar platforms={platformList.map((p) => ({ id: p.id, name: p.name }))} profiles={profiles} />

      {coverage.posts === 0 ? (
        <Alert>
          No posts were published in this period. <Link href="/dashboard/posts" className="font-medium underline">Publish a post</Link> and its numbers appear here
          within about 20 minutes.
        </Alert>
      ) : pending > 0 ? (
        <Alert>
          {pending} of {coverage.posts} published posts have no metrics yet. New posts are first checked about 20 minutes after they go live.
          {unsupported.length ? ` ${unsupported.map((p) => names.get(p) ?? p).join(", ")} do not report post metrics.` : ""}
        </Alert>
      ) : null}

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
        <Stat label="Posts published" value={full(totals.posts)} sub={`${coverage.withMetrics} with metrics`} />
        <Stat label={audienceLabel} value={compact(audience)} sub={audience === null ? "Not reported by these networks" : undefined} />
        <Stat label="Engagements" value={compact(totals.engagements)} sub="Likes, comments, shares, saves, quotes" />
        <Stat label="Engagement rate" value={percent(totals.engagementRate)} sub={totals.engagementRate === null ? "Needs impressions or views" : "Engagements ÷ views and impressions"} />
        <Stat label="Followers" value={compact(followers)} sub={<Delta value={followersChange} />} />
      </div>

      <Card className="p-5">
        <h2 className="font-semibold">Engagements by publish day</h2>
        <p className="mb-3 text-sm text-muted">Total engagements of the posts published on each day.</p>
        <ColumnChart
          label="Engagements by publish day"
          unit="engagements"
          data={overview.daily.map((d) => ({
            date: d.date,
            value: d.engagements,
            detail: `${d.posts} post${d.posts === 1 ? "" : "s"} published${d.views || d.impressions ? ` · ${compact(d.impressions || d.views)} ${d.impressions ? "impressions" : "views"}` : ""}`,
          }))}
        />
        <details className="mt-3 text-sm">
          <summary className="cursor-pointer text-ink-2">Show as table</summary>
          <div className="mt-2 max-h-72 overflow-auto">
            <table className="w-full text-left" style={{ fontVariantNumeric: "tabular-nums" }}>
              <thead className="text-muted">
                <tr><th className="py-1 font-medium">Day</th><th className="py-1 text-right font-medium">Posts</th><th className="py-1 text-right font-medium">Engagements</th><th className="py-1 text-right font-medium">Impressions / views</th></tr>
              </thead>
              <tbody>
                {overview.daily.filter((d) => d.posts > 0).map((d) => (
                  <tr key={d.date} className="border-t border-line">
                    <td className="py-1">{shortDate(d.date)}</td>
                    <td className="py-1 text-right">{d.posts}</td>
                    <td className="py-1 text-right">{full(d.engagements)}</td>
                    <td className="py-1 text-right">{full(d.impressions || d.views)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </details>
      </Card>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <Card className="min-w-0 p-5">
          <h2 className="font-semibold">Engagements by network</h2>
          <p className="mb-4 text-sm text-muted">Largest first. Hover for the breakdown.</p>
          {overview.byPlatform.length ? (
            <RankedBars
              unit="engagements"
              data={overview.byPlatform.map((p) => ({
                key: p.platform,
                platform: p.platform,
                label: names.get(p.platform) ?? p.platform,
                value: p.engagements,
                detail: `${p.posts} posts · ${compact(p.likes)} likes · ${compact(p.comments)} comments · ${compact(p.shares)} shares · rate ${percent(p.engagementRate)}`,
              }))}
            />
          ) : (
            <p className="text-sm text-muted">No data in this period.</p>
          )}
          {overview.byPlatform.length ? (
            <details className="mt-4 text-sm">
              <summary className="cursor-pointer text-ink-2">Show as table</summary>
              <div className="mt-2 overflow-x-auto">
                <table className="w-full text-left" style={{ fontVariantNumeric: "tabular-nums" }}>
                  <thead className="text-muted">
                    <tr>
                      <th className="py-1 font-medium">Network</th>
                      <th className="py-1 text-right font-medium">Posts</th>
                      <th className="py-1 text-right font-medium">Views</th>
                      <th className="py-1 text-right font-medium">Likes</th>
                      <th className="py-1 text-right font-medium">Comments</th>
                      <th className="py-1 text-right font-medium">Shares</th>
                      <th className="py-1 text-right font-medium">Rate</th>
                    </tr>
                  </thead>
                  <tbody>
                    {overview.byPlatform.map((p) => (
                      <tr key={p.platform} className="border-t border-line">
                        <td className="py-1">{names.get(p.platform) ?? p.platform}</td>
                        <td className="py-1 text-right">{p.posts}</td>
                        <td className="py-1 text-right">{full(p.impressions ?? p.views)}</td>
                        <td className="py-1 text-right">{full(p.likes)}</td>
                        <td className="py-1 text-right">{full(p.comments)}</td>
                        <td className="py-1 text-right">{full(p.shares)}</td>
                        <td className="py-1 text-right">{percent(p.engagementRate)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </details>
          ) : null}
        </Card>

        <Card className="min-w-0 p-5">
          <h2 className="font-semibold">Followers</h2>
          <p className="mb-3 text-sm text-muted">Checked twice a day for each connected account.</p>
          {overview.accounts.length === 0 ? (
            <p className="text-sm text-muted">No accounts match these filters.</p>
          ) : (
            <ul className="divide-y divide-line">
              {overview.accounts.map((a) => {
                const support = getAdapter(a.platform)?.analytics;
                return (
                  <li key={a.accountId} className="flex items-center justify-between gap-3 py-2.5">
                    <div className="flex min-w-0 items-center gap-2">
                      <PlatformIcon platform={a.platform} size={22} />
                      <div className="min-w-0">
                        <div className="truncate text-sm font-medium">{a.name}</div>
                        <div className="text-xs text-muted">
                          {!support?.fetchAccountMetrics ? "Not reported by this network" : a.metricsError ? `Could not read: ${a.metricsError.slice(0, 80)}` : <Delta value={a.followersChange} />}
                        </div>
                      </div>
                    </div>
                    <div className="flex items-center gap-3">
                      {a.series.length >= 2 ? <Sparkline values={a.series.map((s) => s.followers)} label={`Followers of ${a.name}`} /> : null}
                      <div className="w-16 text-right text-sm font-semibold" style={{ fontVariantNumeric: "tabular-nums" }}>{a.followers === null ? "n/a" : compact(a.followers)}</div>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </Card>
      </div>

      <Card>
        <div className="px-5 pt-5">
          <h2 className="font-semibold">Top posts</h2>
          <p className="text-sm text-muted">By engagements.</p>
        </div>
        {overview.topPosts.length === 0 ? (
          <p className="p-5 text-sm text-muted">No metrics yet.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="mt-3 w-full min-w-[40rem] text-left text-sm" style={{ fontVariantNumeric: "tabular-nums" }}>
              <thead className="text-muted">
                <tr>
                  <th className="px-5 py-2 font-medium">Post</th>
                  <th className="px-3 py-2 font-medium">Published</th>
                  <th className="px-3 py-2 text-right font-medium">Views</th>
                  <th className="px-3 py-2 text-right font-medium">Engagements</th>
                  <th className="px-5 py-2 text-right font-medium">Rate</th>
                </tr>
              </thead>
              <tbody>
                {overview.topPosts.map((p) => (
                  <tr key={p.targetId} className="border-t border-line">
                    <td className="max-w-md px-5 py-2.5">
                      <div className="flex items-center gap-2">
                        <PlatformIcon platform={p.platform} size={20} />
                        <span className="line-clamp-1">{p.content || "(media only)"}</span>
                      </div>
                      {p.url ? <a href={p.url} target="_blank" rel="noreferrer" className="ml-7 text-xs text-brand">View on {names.get(p.platform) ?? p.platform}</a> : null}
                    </td>
                    <td className="whitespace-nowrap px-3 py-2.5 text-ink-2">{p.publishedAt ? shortDate(p.publishedAt.toISOString().slice(0, 10)) : ""}</td>
                    <td className="px-3 py-2.5 text-right">{full(p.metrics.impressions ?? p.metrics.views ?? p.metrics.reach ?? null)}</td>
                    <td className="px-3 py-2.5 text-right font-semibold">{full(p.engagements)}</td>
                    <td className="px-5 py-2.5 text-right">{percent(p.engagementRate)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  );
}
