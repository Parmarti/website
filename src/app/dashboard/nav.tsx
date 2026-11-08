"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const items = [
  { href: "/dashboard", label: "Overview" },
  { href: "/dashboard/accounts", label: "Accounts" },
  { href: "/dashboard/posts", label: "Posts" },
  { href: "/dashboard/analytics", label: "Analytics" },
  { href: "/dashboard/api-keys", label: "API keys" },
  { href: "/dashboard/webhooks", label: "Webhooks" },
  { href: "/dashboard/apps", label: "Developer apps" },
  { href: "/dashboard/billing", label: "Billing" },
];

export function DashboardNav() {
  const path = usePathname();
  return (
    <nav className="flex gap-1 overflow-x-auto md:flex-col">
      {items.map((item) => {
        const active = item.href === "/dashboard" ? path === item.href : path.startsWith(item.href);
        return (
          <Link
            key={item.href}
            href={item.href}
            className={`whitespace-nowrap rounded-lg px-3 py-2 text-sm font-medium ${active ? "bg-white text-ink shadow-sm ring-1 ring-line" : "text-ink-2 hover:bg-white/60"}`}
          >
            {item.label}
          </Link>
        );
      })}
      <Link href="/docs" className="whitespace-nowrap rounded-lg px-3 py-2 text-sm font-medium text-ink-2 hover:bg-white/60">
        API docs ↗
      </Link>
    </nav>
  );
}
