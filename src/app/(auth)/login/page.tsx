import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";
import { AuthForm } from "../auth-form";
import { login } from "../actions";

export const metadata = { title: "Log in" };

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ next?: string }> }) {
  if (await getCurrentUser()) redirect("/dashboard");
  const { next } = await searchParams;
  return (
    <>
      <h1 className="mb-6 text-xl font-semibold">Log in</h1>
      <AuthForm mode="login" action={login} next={next} />
    </>
  );
}
