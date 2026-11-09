import { SimpleForm } from "../simple-form";
import { forgotPassword } from "../actions";

export const metadata = { title: "Reset your password" };

export default function ForgotPasswordPage() {
  return (
    <>
      <h1 className="text-xl font-semibold">Reset your password</h1>
      <p className="mb-6 mt-1 text-sm text-muted">Enter your email and we will send you a link to choose a new password.</p>
      <SimpleForm action={forgotPassword} submit="Send reset link" fields={[{ name: "email", label: "Email", type: "email", autoComplete: "email" }]} />
    </>
  );
}
