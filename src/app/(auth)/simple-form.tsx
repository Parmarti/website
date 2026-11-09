"use client";

import Link from "next/link";
import { useActionState } from "react";
import { Alert, Button, Input, Label } from "@/components/ui";
import type { AuthState } from "./actions";

interface Field {
  name: string;
  label: string;
  type: string;
  autoComplete?: string;
}

/** A small auth form: fields, a submit button, and the result message. */
export function SimpleForm({
  action,
  fields,
  submit,
  hidden,
}: {
  action: (prev: AuthState, data: FormData) => Promise<AuthState>;
  fields: Field[];
  submit: string;
  hidden?: Record<string, string>;
}) {
  const [state, formAction, pending] = useActionState(action, undefined);
  if (state?.ok) {
    return (
      <div className="space-y-4">
        <Alert tone="green">{state.ok}</Alert>
        <Link href="/login" className="block text-center text-sm font-medium text-brand">Back to log in</Link>
      </div>
    );
  }
  return (
    <form action={formAction} className="space-y-4">
      {state?.error ? <Alert tone="red">{state.error}</Alert> : null}
      {Object.entries(hidden ?? {}).map(([k, v]) => <input key={k} type="hidden" name={k} value={v} />)}
      {fields.map((f) => (
        <div key={f.name}>
          <Label htmlFor={f.name}>{f.label}</Label>
          <Input id={f.name} name={f.name} type={f.type} autoComplete={f.autoComplete} required minLength={f.type === "password" ? 8 : undefined} />
        </div>
      ))}
      <Button type="submit" className="w-full" disabled={pending}>{pending ? "Please wait..." : submit}</Button>
      <p className="text-center text-sm text-muted"><Link className="font-medium text-brand" href="/login">Back to log in</Link></p>
    </form>
  );
}
