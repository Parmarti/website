"use client";

import Link from "next/link";
import { useActionState } from "react";
import { Alert, Button, Input, Label } from "@/components/ui";
import type { AuthState } from "./actions";

export function AuthForm({
  mode,
  action,
  next,
}: {
  mode: "login" | "signup";
  action: (prev: AuthState, data: FormData) => Promise<AuthState>;
  next?: string;
}) {
  const [state, formAction, pending] = useActionState(action, undefined);
  return (
    <form action={formAction} className="space-y-4">
      {state?.error ? <Alert tone="red">{state.error}</Alert> : null}
      {mode === "signup" ? (
        <div>
          <Label htmlFor="name">Name</Label>
          <Input id="name" name="name" autoComplete="name" placeholder="Ada Lovelace" />
        </div>
      ) : null}
      <div>
        <Label htmlFor="email">Work email</Label>
        <Input id="email" name="email" type="email" autoComplete="email" required placeholder="you@company.com" />
      </div>
      <div>
        <Label htmlFor="password">Password</Label>
        <Input id="password" name="password" type="password" autoComplete={mode === "signup" ? "new-password" : "current-password"} required minLength={8} />
      </div>
      {next ? <input type="hidden" name="next" value={next} /> : null}
      <Button type="submit" className="w-full" disabled={pending}>
        {pending ? "Please wait..." : mode === "signup" ? "Create free account" : "Log in"}
      </Button>
      <p className="text-center text-sm text-muted">
        {mode === "signup" ? (
          <>Already have an account? <Link className="font-medium text-brand" href="/login">Log in</Link></>
        ) : (
          <>New here? <Link className="font-medium text-brand" href="/signup">Create a free account</Link></>
        )}
      </p>
    </form>
  );
}
