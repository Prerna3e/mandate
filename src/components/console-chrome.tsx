import { Link } from "@tanstack/react-router";
import type { ReactNode } from "react";

import { cn } from "@/lib/utils";

const NAV = [
  { to: "/", label: "Overview" },
  { to: "/store", label: "Storefront" },
  { to: "/agent", label: "Agent theatre" },
  { to: "/merchant", label: "Merchant console" },
] as const;

export function ConsoleShell({ children }: { children: ReactNode }) {
  return (
    <div className="min-h-screen bg-background">
      <header className="sticky top-0 z-40 border-b border-border bg-background/85 backdrop-blur">
        <div className="mx-auto flex max-w-7xl items-center gap-6 px-5 py-3">
          <Link to="/" className="flex items-center gap-2.5">
            <span className="grid size-6 place-items-center rounded-sm bg-primary font-mono text-[11px] font-bold text-primary-foreground">
              A2
            </span>
            <span className="font-mono text-[13px] tracking-tight text-foreground">
              kalakriti<span className="text-muted-foreground">/agentic-commerce</span>
            </span>
          </Link>
          <nav className="ml-auto flex items-center gap-1">
            {NAV.map((item) => (
              <Link
                key={item.to}
                to={item.to}
                className="rounded-sm px-2.5 py-1.5 font-mono text-[12px] text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
                activeProps={{ className: "bg-accent text-foreground" }}
                activeOptions={{ exact: item.to === "/" }}
              >
                {item.label}
              </Link>
            ))}
          </nav>
          <span className="hidden items-center gap-1.5 rounded-sm border border-border px-2 py-1 font-mono text-[11px] text-muted-foreground sm:flex">
            <span className="size-1.5 rounded-full bg-allow" />
            razorpay test mode
          </span>
        </div>
      </header>
      {children}
      <footer className="mt-20 border-t border-border">
        <div className="mx-auto max-w-7xl px-5 py-8 font-mono text-[11px] text-muted-foreground">
          No real money moves. Every amount is INR minor units (paise) in the audit detail. Track 01 — AI Growth &amp;
          Agentic Commerce.
        </div>
      </footer>
    </div>
  );
}

export function VerdictChip({ verdict }: { verdict: string }) {
  const tone =
    verdict === "allow"
      ? "border-allow/40 bg-allow/10 text-allow"
      : verdict === "deny"
        ? "border-deny/40 bg-deny/10 text-deny"
        : "border-escalate/40 bg-escalate/10 text-escalate";
  return (
    <span className={cn("rounded-sm border px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-wider", tone)}>
      {verdict}
    </span>
  );
}

export function StatusChip({ status }: { status: string }) {
  const tone =
    status === "completed" || status === "settled" || status === "paid" || status === "awaiting_payment"
      ? "border-allow/40 bg-allow/10 text-allow"
      : status === "failed" || status === "blocked"
        ? "border-deny/40 bg-deny/10 text-deny"
        : "border-border bg-muted text-muted-foreground";
  return (
    <span className={cn("rounded-sm border px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-wider", tone)}>
      {status.replace(/_/g, " ")}
    </span>
  );
}

export function SectionLabel({ children }: { children: ReactNode }) {
  return (
    <div className="mb-3 font-mono text-[11px] uppercase tracking-[0.18em] text-muted-foreground">{children}</div>
  );
}
