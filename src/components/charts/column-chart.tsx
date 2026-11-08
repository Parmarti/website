"use client";

import { useState } from "react";
import { compact, full, niceTicks, shortDate } from "./format";
import { useWidth } from "./use-width";

export interface ColumnDatum {
  date: string; // YYYY-MM-DD
  value: number;
  detail?: string; // secondary line in the tooltip
}

const HEIGHT = 240;
const PAD = { top: 12, right: 8, bottom: 28, left: 44 };

function columnPath(x: number, y: number, w: number, base: number, radius = 4) {
  const r = Math.min(radius, w / 2, base - y);
  return `M${x},${base} L${x},${y + r} Q${x},${y} ${x + r},${y} L${x + w - r},${y} Q${x + w},${y} ${x + w},${y + r} L${x + w},${base} Z`;
}

/** Single-series column chart over days. Hover or arrow keys show the value; the table view lives next to it. */
export function ColumnChart({ data, label, unit }: { data: ColumnDatum[]; label: string; unit: string }) {
  const { ref, width } = useWidth<HTMLDivElement>();
  const [active, setActive] = useState<number | null>(null);

  const max = Math.max(0, ...data.map((d) => d.value));
  const ticks = niceTicks(max);
  const top = ticks[ticks.length - 1] || 1;
  const plotW = width - PAD.left - PAD.right;
  const plotH = HEIGHT - PAD.top - PAD.bottom;
  const base = PAD.top + plotH;
  const band = plotW / Math.max(1, data.length);
  const barW = Math.max(2, Math.min(24, band * 0.62));
  const y = (v: number) => PAD.top + plotH - (v / top) * plotH;
  const labelEvery = Math.max(1, Math.ceil(data.length / Math.max(2, Math.floor(plotW / 72))));
  const current = active !== null ? data[active] : null;
  const tipLeft = active !== null ? Math.min(Math.max(PAD.left + band * active + band / 2, 90), width - 90) : 0;

  return (
    <div ref={ref} className="viz-root relative w-full select-none" style={{ minHeight: HEIGHT }}>
      {width > 0 ? (
      <svg
        width={width}
        height={HEIGHT}
        role="img"
        aria-label={`${label}. Use the left and right arrow keys to read each day.`}
        tabIndex={0}
        className="block rounded outline-none focus-visible:ring-2 focus-visible:ring-brand/40"
        onKeyDown={(e) => {
          if (e.key === "ArrowRight") setActive((i) => Math.min(data.length - 1, (i ?? -1) + 1));
          else if (e.key === "ArrowLeft") setActive((i) => Math.max(0, (i ?? data.length) - 1));
          else if (e.key === "Escape") setActive(null);
          else return;
          e.preventDefault();
        }}
        onBlur={() => setActive(null)}
        onPointerLeave={() => setActive(null)}
      >
        {ticks.map((t) => (
          <g key={t}>
            <line x1={PAD.left} x2={width - PAD.right} y1={y(t)} y2={y(t)} stroke={t === 0 ? "var(--viz-axis)" : "var(--viz-grid)"} strokeWidth={1} shapeRendering="crispEdges" />
            <text x={PAD.left - 8} y={y(t)} dy="0.32em" textAnchor="end" fontSize={11} fill="var(--viz-muted)" style={{ fontVariantNumeric: "tabular-nums" }}>
              {top >= 10_000 ? compact(t) : full(t)}
            </text>
          </g>
        ))}
        {data.map((d, i) => {
          const x = PAD.left + band * i + (band - barW) / 2;
          return (
            <g key={d.date}>
              {d.value > 0 ? (
                <path d={columnPath(x, y(d.value), barW, base)} fill="var(--viz-series-1)" opacity={active === null || active === i ? 1 : 0.55} />
              ) : null}
              {i % labelEvery === 0 ? (
                <text x={PAD.left + band * i + band / 2} y={HEIGHT - 8} textAnchor="middle" fontSize={11} fill="var(--viz-muted)">
                  {shortDate(d.date)}
                </text>
              ) : null}
              {/* Hit target: the whole band, taller than the mark. */}
              <rect x={PAD.left + band * i} y={PAD.top} width={band} height={plotH} fill="transparent" onPointerEnter={() => setActive(i)} onPointerMove={() => setActive(i)} />
            </g>
          );
        })}
      </svg>
      ) : null}
      {current ? (
        <div
          role="status"
          className="pointer-events-none absolute top-1 z-10 -translate-x-1/2 rounded-lg border border-line bg-white px-3 py-2 text-xs shadow-md"
          style={{ left: tipLeft }}
        >
          <div className="text-muted">{shortDate(current.date)}</div>
          <div className="mt-0.5 flex items-center gap-2">
            <span className="inline-block h-0.5 w-3 rounded" style={{ background: "var(--viz-series-1)" }} />
            <span className="text-sm font-semibold text-ink">{full(current.value)}</span>
            <span className="text-ink-2">{unit}</span>
          </div>
          {current.detail ? <div className="mt-0.5 text-ink-2">{current.detail}</div> : null}
        </div>
      ) : null}
    </div>
  );
}
