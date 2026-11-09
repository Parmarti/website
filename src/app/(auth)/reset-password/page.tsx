import Link from "next/link";
import { findValidResetToken } from "@/lib/password-reset";
import { Alert } from "@/components/ui";
import { SimpleForm } from "../simple-form";
import { resetPassword } from "../actions";

export const metadata = { title: "Choose a new password", robots: { index: false } };
export const dynamic = "force-dynamic";

export default async function ResetPasswordPage({ searchParams }: { searchParams: Promise<{ token?: string }> }) {
  const { token } = await searchParams;
  const valid = await findValidResetToken(token);
  if (!valid || !token) {
    return (
      <div className="space-y-4">
        <h1 className="text-xl font-semibold">Link expired</h1>
        <Alert tone="amber">This reset link has expired or was already used.</Alert>
        <Link href="/forgot-password" className="block text-center text-sm font-medium text-brand">Ask for a new link</Link>
      </div>
    );
  }
  return (
    <>
      <h1 className="mb-6 text-xl font-semibold">Choose a new password</h1>
      <SimpleForm
        action={resetPassword}
        submit="Save new password"
        hidden={{ token }}
        fields={[
          { name: "password", label: "New password", type: "password", autoComplete: "new-password" },
          { name: "confirm", label: "Repeat the new password", type: "password", autoComplete: "new-password" },
        ]}
      />
    </>
  );
}
