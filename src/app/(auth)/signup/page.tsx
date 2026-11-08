import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";
import { AuthForm } from "../auth-form";
import { signup } from "../actions";

export const metadata = { title: "Create your account" };

export default async function SignupPage() {
  if (await getCurrentUser()) redirect("/dashboard");
  return (
    <>
      <h1 className="text-xl font-semibold">Create your account</h1>
      <p className="mb-6 mt-1 text-sm text-muted">Free for 2 accounts. No credit card.</p>
      <AuthForm mode="signup" action={signup} />
    </>
  );
}
