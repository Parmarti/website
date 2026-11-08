import Link from "next/link";
import { brand } from "@/lib/brand";

export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-wash px-4 py-12">
      <Link href="/" className="mb-8 text-xl font-bold tracking-tight">{brand.name}</Link>
      <div className="w-full max-w-sm rounded-2xl border border-line bg-white p-6 shadow-sm sm:p-8">{children}</div>
    </div>
  );
}
