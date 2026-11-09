import { requireUser } from "@/lib/auth";
import { Card, PageHeader } from "@/components/ui";
import { DeleteAccountForm, PasswordForm, ProfileForm } from "./forms";

export const metadata = { title: "Settings" };

export default async function SettingsPage() {
  const user = await requireUser();
  return (
    <div className="space-y-6">
      <PageHeader title="Settings" description={`Signed in as ${user.email}.`} />
      <Card className="p-5">
        <h2 className="mb-3 font-semibold">Profile</h2>
        <ProfileForm name={user.name ?? ""} />
      </Card>
      <Card className="p-5">
        <h2 className="mb-3 font-semibold">Password</h2>
        <PasswordForm />
      </Card>
      <Card className="border-red-200 p-5">
        <h2 className="font-semibold text-bad">Delete account</h2>
        <p className="mb-3 mt-1 text-sm text-muted">
          This cancels your subscription and permanently deletes your connected accounts and their tokens, posts, analytics, API keys, webhooks and uploaded
          files. Posts already published stay on the social networks. This cannot be undone.
        </p>
        <DeleteAccountForm email={user.email} />
      </Card>
    </div>
  );
}
