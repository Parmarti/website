"use client";

import { useActionState, useState } from "react";
import { Alert, Button } from "@/components/ui";
import { saveSelection } from "./actions";

export interface Choice {
  id: string;
  name: string;
  detail: string | null;
  avatarUrl: string | null;
  alreadyConnected: boolean;
}

export function SelectForm({ platform, state, choices, capacity }: { platform: string; state: string; choices: Choice[]; capacity: number }) {
  const [result, action, pending] = useActionState(saveSelection, undefined);
  const [selected, setSelected] = useState<string[]>(() =>
    choices.filter((c) => c.alreadyConnected).map((c) => c.id).concat(choices.filter((c) => !c.alreadyConnected).slice(0, capacity).map((c) => c.id)),
  );
  const newCount = selected.filter((id) => !choices.find((c) => c.id === id)?.alreadyConnected).length;
  const over = newCount > capacity;

  return (
    <form action={action} className="space-y-4">
      <input type="hidden" name="platform" value={platform} />
      <input type="hidden" name="state" value={state} />
      {result?.error ? <Alert tone="red">{result.error}</Alert> : null}
      <ul className="max-h-80 divide-y divide-line overflow-y-auto rounded-lg border border-line">
        {choices.map((c) => (
          <li key={c.id}>
            <label className="flex cursor-pointer items-center gap-3 px-3 py-2.5 hover:bg-wash">
              <input
                type="checkbox"
                name="ids"
                value={c.id}
                checked={selected.includes(c.id)}
                onChange={(e) => setSelected((s) => (e.target.checked ? [...s, c.id] : s.filter((x) => x !== c.id)))}
              />
              {c.avatarUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={c.avatarUrl} alt="" className="h-8 w-8 rounded-full" />
              ) : (
                <span className="h-8 w-8 rounded-full bg-wash ring-1 ring-line" />
              )}
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-medium">{c.name}</span>
                {c.detail ? <span className="block truncate text-xs text-muted">{c.detail}</span> : null}
              </span>
              {c.alreadyConnected ? <span className="text-xs text-muted">connected</span> : null}
            </label>
          </li>
        ))}
      </ul>
      <p className={`text-xs ${over ? "text-bad" : "text-muted"}`}>
        {newCount} new selected. Your plan has room for {capacity} more account{capacity === 1 ? "" : "s"}.
      </p>
      <Button className="w-full" disabled={pending || selected.length === 0 || over}>
        {pending ? "Saving..." : `Add ${selected.length} account${selected.length === 1 ? "" : "s"}`}
      </Button>
    </form>
  );
}
