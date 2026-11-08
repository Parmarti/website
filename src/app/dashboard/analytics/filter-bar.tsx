"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useTransition } from "react";

export function FilterBar({ platforms, profiles }: { platforms: { id: string; name: string }[]; profiles: { id: string; name: string }[] }) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const [pending, startTransition] = useTransition();
  const days = params.get("days") || "30";

  const set = (key: string, value: string) => {
    const next = new URLSearchParams(params.toString());
    if (value) next.set(key, value);
    else next.delete(key);
    startTransition(() => router.push(`${pathname}?${next.toString()}`));
  };

  return (
    <div className={`flex flex-wrap items-center gap-2 transition-opacity ${pending ? "opacity-60" : ""}`}>
      <div role="group" aria-label="Date range" className="inline-flex rounded-lg border border-line bg-white p-0.5">
        {["7", "30", "90"].map((d) => (
          <button
            key={d}
            type="button"
            aria-pressed={days === d}
            onClick={() => set("days", d === "30" ? "" : d)}
            className={`rounded-md px-3 py-1.5 text-sm font-medium ${days === d ? "bg-wash text-ink ring-1 ring-line" : "text-ink-2 hover:bg-wash/60"}`}
          >
            Last {d} days
          </button>
        ))}
      </div>
      <select
        aria-label="Network"
        value={params.get("platform") ?? ""}
        onChange={(e) => set("platform", e.target.value)}
        className="h-9 rounded-lg border border-line bg-white px-3 text-sm"
      >
        <option value="">All networks</option>
        {platforms.map((p) => (
          <option key={p.id} value={p.id}>{p.name}</option>
        ))}
      </select>
      {profiles.length > 1 ? (
        <select
          aria-label="Profile"
          value={params.get("profileId") ?? ""}
          onChange={(e) => set("profileId", e.target.value)}
          className="h-9 rounded-lg border border-line bg-white px-3 text-sm"
        >
          <option value="">All profiles</option>
          {profiles.map((p) => (
            <option key={p.id} value={p.id}>{p.name}</option>
          ))}
        </select>
      ) : null}
    </div>
  );
}
