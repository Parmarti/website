import Link from "next/link";
import type { ComponentProps, ReactNode } from "react";

type Variant = "primary" | "secondary" | "ghost" | "danger";

const variants: Record<Variant, string> = {
  primary: "bg-brand text-white hover:bg-brand/90 shadow-sm",
  secondary: "bg-white text-ink border border-line hover:bg-wash",
  ghost: "text-ink-2 hover:bg-wash",
  danger: "bg-white text-bad border border-line hover:bg-red-50",
};

export function buttonClass(variant: Variant = "primary", size: "sm" | "md" | "lg" = "md") {
  const sizes = { sm: "h-8 px-3 text-sm", md: "h-10 px-4 text-sm", lg: "h-12 px-6 text-base" };
  return `inline-flex items-center justify-center gap-2 rounded-lg font-medium transition-colors disabled:opacity-50 disabled:pointer-events-none ${sizes[size]} ${variants[variant]}`;
}

export function Button({ variant = "primary", size = "md", className = "", ...props }: ComponentProps<"button"> & { variant?: Variant; size?: "sm" | "md" | "lg" }) {
  return <button className={`${buttonClass(variant, size)} ${className}`} {...props} />;
}

export function LinkButton({ variant = "primary", size = "md", className = "", ...props }: ComponentProps<typeof Link> & { variant?: Variant; size?: "sm" | "md" | "lg" }) {
  return <Link className={`${buttonClass(variant, size)} ${className}`} {...props} />;
}

export function Card({ className = "", children }: { className?: string; children: ReactNode }) {
  return <div className={`rounded-xl border border-line bg-white ${className}`}>{children}</div>;
}

export function Input({ className = "", ...props }: ComponentProps<"input">) {
  return (
    <input
      className={`h-10 w-full rounded-lg border border-line bg-white px-3 text-sm outline-none focus:border-brand focus:ring-2 focus:ring-brand/20 ${className}`}
      {...props}
    />
  );
}

export function Textarea({ className = "", ...props }: ComponentProps<"textarea">) {
  return (
    <textarea
      className={`w-full rounded-lg border border-line bg-white px-3 py-2 text-sm outline-none focus:border-brand focus:ring-2 focus:ring-brand/20 ${className}`}
      {...props}
    />
  );
}

export function Select({ className = "", ...props }: ComponentProps<"select">) {
  return (
    <select
      className={`h-10 w-full rounded-lg border border-line bg-white px-3 text-sm outline-none focus:border-brand focus:ring-2 focus:ring-brand/20 ${className}`}
      {...props}
    />
  );
}

export function Label({ children, htmlFor, hint }: { children: ReactNode; htmlFor?: string; hint?: ReactNode }) {
  return (
    <label htmlFor={htmlFor} className="mb-1.5 block text-sm font-medium text-ink">
      {children}
      {hint ? <span className="mt-0.5 block text-xs font-normal text-muted">{hint}</span> : null}
    </label>
  );
}

const badgeTones = {
  gray: "bg-wash text-ink-2 border-line",
  green: "bg-emerald-50 text-emerald-700 border-emerald-200",
  amber: "bg-amber-50 text-amber-700 border-amber-200",
  red: "bg-red-50 text-red-700 border-red-200",
  blue: "bg-indigo-50 text-indigo-700 border-indigo-200",
};

export function Badge({ tone = "gray", children }: { tone?: keyof typeof badgeTones; children: ReactNode }) {
  return <span className={`inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-medium ${badgeTones[tone]}`}>{children}</span>;
}

export function statusTone(status: string): keyof typeof badgeTones {
  if (["published", "active"].includes(status)) return "green";
  if (["partial", "publishing", "scheduled", "pending"].includes(status)) return status === "partial" ? "amber" : "blue";
  if (["failed", "expired", "error"].includes(status)) return "red";
  return "gray";
}

export function PageHeader({ title, description, actions }: { title: string; description?: ReactNode; actions?: ReactNode }) {
  return (
    <div className="mb-6 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
        {description ? <p className="mt-1 text-sm text-muted">{description}</p> : null}
      </div>
      {actions}
    </div>
  );
}

export function Alert({ tone = "blue", children }: { tone?: "blue" | "green" | "red" | "amber"; children: ReactNode }) {
  const tones = {
    blue: "border-indigo-200 bg-indigo-50 text-indigo-900",
    green: "border-emerald-200 bg-emerald-50 text-emerald-900",
    red: "border-red-200 bg-red-50 text-red-900",
    amber: "border-amber-200 bg-amber-50 text-amber-900",
  };
  return <div className={`rounded-lg border px-4 py-3 text-sm ${tones[tone]}`}>{children}</div>;
}

export function CodeBlock({ children, className = "" }: { children: ReactNode; className?: string }) {
  return (
    <pre className={`code-block overflow-x-auto rounded-xl p-4 font-mono text-[13px] leading-relaxed ${className}`}>
      <code>{children}</code>
    </pre>
  );
}
