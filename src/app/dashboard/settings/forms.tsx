"use client";

import { useActionState } from "react";
import { Alert, Button, Input, Label } from "@/components/ui";
import { changePassword, deleteAccount, updateProfile, type SettingsState } from "./actions";

function Result({ state }: { state: SettingsState }) {
  if (!state) return null;
  return <Alert tone={state.error ? "red" : "green"}>{state.error ?? state.ok}</Alert>;
}

export function ProfileForm({ name }: { name: string }) {
  const [state, action, pending] = useActionState(updateProfile, undefined);
  return (
    <form action={action} className="space-y-3">
      <div className="sm:w-80">
        <Label htmlFor="name">Name</Label>
        <Input id="name" name="name" defaultValue={name} maxLength={100} autoComplete="name" />
      </div>
      <Button variant="secondary" disabled={pending}>{pending ? "Saving..." : "Save"}</Button>
      <Result state={state} />
    </form>
  );
}

export function PasswordForm() {
  const [state, action, pending] = useActionState(changePassword, undefined);
  return (
    <form action={action} className="space-y-3">
      <div className="grid gap-3 sm:grid-cols-3">
        <div>
          <Label htmlFor="current">Current password</Label>
          <Input id="current" name="current" type="password" autoComplete="current-password" required />
        </div>
        <div>
          <Label htmlFor="password">New password</Label>
          <Input id="password" name="password" type="password" autoComplete="new-password" minLength={8} required />
        </div>
        <div>
          <Label htmlFor="confirm">Repeat new password</Label>
          <Input id="confirm" name="confirm" type="password" autoComplete="new-password" minLength={8} required />
        </div>
      </div>
      <Button variant="secondary" disabled={pending}>{pending ? "Saving..." : "Change password"}</Button>
      <Result state={state} />
    </form>
  );
}

export function DeleteAccountForm({ email }: { email: string }) {
  const [state, action, pending] = useActionState(deleteAccount, undefined);
  return (
    <form action={action} className="space-y-3">
      <div className="sm:w-80">
        <Label htmlFor="confirm-delete" hint={<>Type <strong>{email}</strong> to confirm.</>}>Your email</Label>
        <Input id="confirm-delete" name="confirm" autoComplete="off" required />
      </div>
      <Button variant="danger" disabled={pending}>{pending ? "Deleting..." : "Delete my account"}</Button>
      <Result state={state} />
    </form>
  );
}
