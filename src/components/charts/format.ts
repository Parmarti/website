export function compact(n: number | null | undefined): string {
  if (n === null || n === undefined) return "n/a";
  const abs = Math.abs(n);
  if (abs >= 1_000_000) return `${(n / 1_000_000).toFixed(abs >= 10_000_000 ? 0 : 1).replace(/\.0$/, "")}M`;
  if (abs >= 10_000) return `${(n / 1000).toFixed(0)}K`;
  if (abs >= 1_000) return `${(n / 1000).toFixed(1).replace(/\.0$/, "")}K`;
  return String(Math.round(n));
}

export function full(n: number | null | undefined): string {
  return n === null || n === undefined ? "n/a" : Math.round(n).toLocaleString("en-US");
}

export function percent(r: number | null | undefined): string {
  return r === null || r === undefined ? "n/a" : `${(r * 100).toFixed(r < 0.1 ? 2 : 1)}%`;
}

/** Clean axis ticks: 0 and 3 to 5 round steps that cover max. */
export function niceTicks(max: number, count = 4): number[] {
  if (max <= 0) return [0, 1];
  const raw = max / count;
  const mag = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => s >= raw) ?? 10 * mag;
  const ticks: number[] = [];
  for (let v = 0; v <= max + step * 0.0001; v += step) ticks.push(Math.round(v * 1000) / 1000);
  if (ticks[ticks.length - 1] < max) ticks.push(ticks[ticks.length - 1] + step);
  return ticks;
}

export function shortDate(iso: string): string {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
}
