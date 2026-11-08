import Link from "next/link";
import { requireUser } from "@/lib/auth";
import { brand } from "@/lib/brand";
import { getPlan } from "@/lib/plans";
import { Badge } from "@/components/ui";
import { logout } from "../(auth)/actions";
import { DashboardNav } from "./nav";

export const dynamic = "force-dynamic";

export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  const user = await requireUser();
  return (
    <div className="min-h-screen bg-wash">
      <header className="sticky top-0 z-10 border-b border-line bg-white/90 backdrop-blur">
        <div className="mx-auto flex h-14 max-w-7xl items-center justify-between px-4">
          <div className="flex items-center gap-3">
            <Link href="/dashboard" className="font-bold tracking-tight">{brand.name}</Link>
            <Badge tone="blue">{getPlan(user.plan).name}</Badge>
          </div>
          <div className="flex items-center gap-3 text-sm">
            <span className="hidden text-muted sm:inline">{user.email}</span>
            <form action={logout}>
              <button className="text-ink-2 hover:text-ink">Log out</button>
            </form>
          </div>
        </div>
      </header>
      <div className="mx-auto flex max-w-7xl flex-col gap-6 px-4 py-6 md:flex-row">
        <aside className="md:w-52 md:shrink-0">
          <DashboardNav />
        </aside>
        <main className="min-w-0 flex-1">{children}</main>
      </div>
    </div>
  );
}
