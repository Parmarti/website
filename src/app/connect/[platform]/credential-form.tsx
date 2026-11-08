"use client";

import { useActionState } from "react";
import { Alert, Button, Input, Label } from "@/components/ui";
import type { CredentialField } from "@/lib/platforms/types";
import { connectWithCredentials } from "./actions";

export function CredentialForm({ platform, state, fields, name }: { platform: string; state: string; fields: CredentialField[]; name: string }) {
  const [result, action, pending] = useActionState(connectWithCredentials, undefined);
  return (
    <form action={action} className="space-y-4">
      <input type="hidden" name="platform" value={platform} />
      <input type="hidden" name="state" value={state} />
      {result?.error ? <Alert tone="red">{result.error}</Alert> : null}
      {fields.map((f) => (
        <div key={f.name}>
          <Label htmlFor={f.name} hint={f.help}>
            {f.label}
            {f.optional ? <span className="font-normal text-muted"> (optional)</span> : null}
          </Label>
          <Input id={f.name} name={f.name} type={f.type === "password" ? "password" : "text"} placeholder={f.placeholder} required={!f.optional} autoComplete="off" />
        </div>
      ))}
      <Button className="w-full" disabled={pending}>{pending ? "Checking..." : `Connect ${name}`}</Button>
    </form>
  );
}
