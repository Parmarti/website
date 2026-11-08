import Link from "next/link";
import { brand } from "@/lib/brand";
import { getCurrentUser } from "@/lib/auth";
import { LinkButton } from "./ui";

export async function SiteHeader() {
  const user = await getCurrentUser();
  return (
    <header className="sticky top-0 z-20 border-b border-line/70 bg-white/85 backdrop-blur">
      <div className="mx-auto flex h-16 max-w-6xl items-center justify-between px-4">
        <Link href="/" className="flex items-center gap-2 text-lg font-bold tracking-tight">
          <span className="inline-block h-6 w-6 rounded-md bg-gradient-to-br from-brand to-brand-2" aria-hidden />
          {brand.name}
        </Link>
        <nav className="flex items-center gap-1 text-sm sm:gap-4">
          <Link href="/docs" className="hidden px-2 text-ink-2 hover:text-ink sm:inline">Docs</Link>
          <Link href="/pricing" className="px-2 text-ink-2 hover:text-ink">Pricing</Link>
          {user ? (
            <LinkButton href="/dashboard" size="sm">Dashboard</LinkButton>
          ) : (
            <>
              <Link href="/login" className="hidden px-2 text-ink-2 hover:text-ink sm:inline">Log in</Link>
              <LinkButton href="/signup" size="sm">Start free</LinkButton>
            </>
          )}
        </nav>
      </div>
    </header>
  );
}

export function SiteFooter() {
  return (
    <footer className="border-t border-line bg-wash">
      <div className="mx-auto flex max-w-6xl flex-col gap-4 px-4 py-10 text-sm text-muted sm:flex-row sm:justify-between">
        <div>
          <div className="font-semibold text-ink">{brand.name}</div>
          <div className="mt-1">{brand.tagline}</div>
        </div>
        <div className="flex flex-wrap gap-x-6 gap-y-2">
          <Link href="/docs" className="hover:text-ink">API docs</Link>
          <Link href="/pricing" className="hover:text-ink">Pricing</Link>
          <Link href="/legal/terms" className="hover:text-ink">Terms</Link>
          <Link href="/legal/privacy" className="hover:text-ink">Privacy</Link>
          <a href={`mailto:${brand.supportEmail}`} className="hover:text-ink">{brand.supportEmail}</a>
        </div>
      </div>
    </footer>
  );
}
