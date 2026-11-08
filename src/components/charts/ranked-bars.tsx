"use client";

import { useState } from "react";
import { PlatformIcon } from "../platform-icon";
import { full } from "./format";

export interface RankedDatum {
  key: string;
  label: string;
  platform?: string;
  value: number;
  detail?: string;
}

/** Ranked horizontal bars, one hue, largest first. Value at the bar tip; details on hover or focus. */
export function RankedBars({ data, unit }: { data: RankedDatum[]; unit: string }) {
  const [active, setActive] = useState<string | null>(null);
  const sorted = [...data].sort((a, b) => b.value - a.value);
  const max = Math.max(1, ...sorted.map((d) => d.value));

  return (
    <ul className="viz-root space-y-2.5">
      {sorted.map((d) => {
        const pct = (d.value / max) * 100;
        const on = active === d.key;
        return (
          <li
            key={d.key}
            tabIndex={0}
            onPointerEnter={() => setActive(d.key)}
            onPointerLeave={() => setActive(null)}
            onFocus={() => setActive(d.key)}
            onBlur={() => setActive(null)}
            className="relative grid grid-cols-[minmax(0,9rem)_1fr] items-center gap-3 rounded-md px-1 py-0.5 outline-none focus-visible:ring-2 focus-visible:ring-brand/40"
            aria-label={`${d.label}: ${full(d.value)} ${unit}${d.detail ? `. ${d.detail}` : ""}`}
          >
            <span className="flex min-w-0 items-center gap-2 text-sm text-ink">
              {d.platform ? <PlatformIcon platform={d.platform} size={18} /> : null}
              <span className="truncate">{d.label}</span>
            </span>
            <span className="flex min-w-0 items-center gap-2">
              <span
                className="block h-3.5 rounded-r transition-opacity"
                style={{ width: `max(${d.value > 0 ? 2 : 0}px, calc(${pct}% - 3.5rem))`, background: "var(--viz-series-1)", opacity: active && !on ? 0.55 : 1 }}
              />
              <span className="shrink-0 text-xs font-medium text-ink" style={{ fontVariantNumeric: "tabular-nums" }}>
                {full(d.value)}
              </span>
            </span>
            {on && d.detail ? (
              <span role="status" className="pointer-events-none absolute -top-9 left-36 z-10 whitespace-nowrap rounded-lg border border-line bg-white px-3 py-1.5 text-xs text-ink-2 shadow-md">
                {d.detail}
              </span>
            ) : null}
          </li>
        );
      })}
    </ul>
  );
}
