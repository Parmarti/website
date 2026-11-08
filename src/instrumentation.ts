/**
 * Runs once when the Node server starts. With RUN_SCHEDULER=1 (single server deploys such as
 * Railway, Render, Fly or Docker) the scheduler runs inside the web process every 30 seconds.
 * On serverless hosts leave it off and call /api/cron/publish every minute instead.
 */
export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs" || process.env.RUN_SCHEDULER !== "1") return;
  const { schedulerTick } = await import("./lib/publisher");
  const g = globalThis as unknown as { __schedulerStarted?: boolean };
  if (g.__schedulerStarted) return;
  g.__schedulerStarted = true;
  const tick = () => schedulerTick().catch((err) => console.error("[scheduler] tick failed", err));
  setInterval(tick, Number(process.env.SCHEDULER_INTERVAL_MS) || 30_000);
  setTimeout(tick, 5_000);
  console.log("[scheduler] in-process scheduler started");
}
