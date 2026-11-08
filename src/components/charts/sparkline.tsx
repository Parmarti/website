/** Tiny trend line: de-emphasis gray, latest point in the accent with a surface ring. */
export function Sparkline({ values, label, width = 96, height = 28 }: { values: number[]; label: string; width?: number; height?: number }) {
  if (values.length < 2) return <span className="text-xs text-muted">Not enough history yet</span>;
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = max - min || 1;
  const pad = 5;
  const x = (i: number) => pad + (i / (values.length - 1)) * (width - pad * 2);
  const y = (v: number) => height - pad - ((v - min) / span) * (height - pad * 2);
  const d = values.map((v, i) => `${i ? "L" : "M"}${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(" ");
  const last = values.length - 1;
  return (
    <svg width={width} height={height} role="img" aria-label={label} className="viz-root block overflow-visible">
      <path d={d} fill="none" stroke="var(--viz-deemph)" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" />
      <circle cx={x(last)} cy={y(values[last])} r={4} fill="var(--viz-series-1)" stroke="var(--viz-surface)" strokeWidth={2} />
    </svg>
  );
}
