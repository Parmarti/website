// Standalone scheduler process: `npm run worker`. Use this if you run the web app on serverless.
import { schedulerTick } from "../src/lib/publisher";

const interval = Number(process.env.SCHEDULER_INTERVAL_MS) || 30_000;

async function loop() {
  for (;;) {
    try {
      const result = await schedulerTick();
      if (result.processed) console.log(`[worker] processed ${result.processed} targets`);
    } catch (err) {
      console.error("[worker] tick failed", err);
    }
    await new Promise((r) => setTimeout(r, interval));
  }
}

console.log(`[worker] started, interval ${interval}ms`);
loop();
