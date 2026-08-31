import { createFileRoute, Link } from "@tanstack/react-router";
import { queryOptions, useSuspenseQuery } from "@tanstack/react-query";
import { useMemo, useState } from "react";

import { ConsoleShell, SectionLabel, StatusChip } from "@/components/console-chrome";
import { getSessionBundle } from "@/lib/public-data.functions";
import { formatINR } from "@/lib/money";

const sessionQuery = (sessionId: string) =>
  queryOptions({
    queryKey: ["session-bundle", sessionId],
    queryFn: () => getSessionBundle({ data: { sessionId } }),
    refetchInterval: (query) => {
      const status = query.state.data?.session?.status;
      return status === "running" ? 1500 : false;
    },
  });

export const Route = createFileRoute("/audit/$sessionId")({
  head: ({ params }) => ({
    meta: [
      { title: `Audit Log — Session ${params.sessionId.slice(0, 8)}` },
      {
        name: "description",
        content: "Complete chronological audit trail of agent messages, policy verdicts, and Razorpay payment operations.",
      },
      { property: "og:title", content: `Audit Log — Session ${params.sessionId.slice(0, 8)}` },
    ],
  }),
  loader: ({ context, params }) => context.queryClient.ensureQueryData(sessionQuery(params.sessionId)),
  component: AuditPage,
  errorComponent: () => (
    <ConsoleShell>
      <div className="mx-auto max-w-3xl px-5 py-24 text-center">
        <h1 className="text-xl font-bold text-foreground">Session Not Found</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          The requested agent session audit log could not be loaded.
        </p>
        <Link
          to="/agent"
          className="mt-6 inline-block rounded-sm bg-primary px-4 py-2 font-mono text-xs text-primary-foreground"
        >
          ← Return to Agent Theatre
        </Link>
      </div>
    </ConsoleShell>
  ),
});

type FilterType = "all" | "message" | "policy" | "audit" | "payment";

interface UnifiedTimelineItem {
  id: string;
  ts: string;
  kind: "message" | "policy" | "audit" | "payment";
  actor: string;
  badge: string;
  verdict?: "allow" | "deny" | "escalate";
  summary: string;
  detail: Record<string, unknown>;
}

function AuditPage() {
  const { sessionId } = Route.useParams();
  const { data: bundle } = useSuspenseQuery(sessionQuery(sessionId));
  const [filter, setFilter] = useState<FilterType>("all");
  const [expandedItems, setExpandedItems] = useState<Record<string, boolean>>({});

  const { session, messages, decisions, events, orders } = bundle;

  // Merge all streams into one chronological timeline
  const timeline = useMemo(() => {
    const items: UnifiedTimelineItem[] = [];

    // Messages
    for (const m of messages ?? []) {
      items.push({
        id: `msg-${m.id}`,
        ts: m.created_at,
        kind: "message",
        actor: m.sender,
        badge: m.kind,
        summary: m.body,
        detail: (m.payload as Record<string, unknown>) ?? {},
      });
    }

    // Decisions
    for (const d of decisions ?? []) {
      items.push({
        id: `dec-${d.id}`,
        ts: d.created_at,
        kind: "policy",
        actor: d.actor,
        badge: d.rule_name,
        verdict: d.verdict as "allow" | "deny" | "escalate",
        summary: d.reason,
        detail: {
          action: d.action,
          rule_name: d.rule_name,
          inputs: d.inputs,
          verdict: d.verdict,
        },
      });
    }

    // Events
    for (const e of events ?? []) {
      const isPayment =
        e.event_type.startsWith("razorpay.") ||
        e.event_type.startsWith("payment.") ||
        e.event_type.startsWith("webhook.");
      items.push({
        id: `evt-${e.id}`,
        ts: e.created_at,
        kind: isPayment ? "payment" : "audit",
        actor: e.actor,
        badge: e.event_type,
        summary: e.summary,
        detail: (e.detail as Record<string, unknown>) ?? {},
      });
    }

    // Sort chronologically by timestamp
    return items.sort((a, b) => new Date(a.ts).getTime() - new Date(b.ts).getTime());
  }, [messages, decisions, events]);

  const filteredTimeline = useMemo(() => {
    if (filter === "all") return timeline;
    return timeline.filter((item) => item.kind === filter);
  }, [timeline, filter]);

  const toggleExpand = (id: string) => {
    setExpandedItems((prev) => ({ ...prev, [id]: !prev[id] }));
  };

  const exportJson = () => {
    const jsonString = `data:text/json;charset=utf-8,${encodeURIComponent(JSON.stringify(bundle, null, 2))}`;
    const downloadAnchor = document.createElement("a");
    downloadAnchor.setAttribute("href", jsonString);
    downloadAnchor.setAttribute("download", `audit-session-${sessionId.slice(0, 8)}.json`);
    document.body.appendChild(downloadAnchor);
    downloadAnchor.click();
    downloadAnchor.remove();
  };

  const primaryOrder = orders?.[0];
  const cartLines = (primaryOrder?.cart as Array<{ sku: string; title: string; qty: number; unit_price_paise: number }>) ?? [];
  const mandateBudget = (session?.mandate as { budget_paise?: number })?.budget_paise ?? 0;

  return (
    <ConsoleShell>
      <main className="mx-auto max-w-7xl px-5 py-10">
        {/* Header Breadcrumbs & Status */}
        <div className="flex flex-wrap items-center justify-between gap-4 border-b border-border pb-6">
          <div>
            <div className="flex items-center gap-2 font-mono text-[11px] text-muted-foreground">
              <Link to="/agent" className="hover:text-foreground">
                agent theatre
              </Link>
              <span>/</span>
              <span className="text-foreground">session {sessionId.slice(0, 8)}</span>
            </div>
            <h1 className="mt-2 text-2xl font-bold tracking-tight text-foreground sm:text-3xl">
              Audit Timeline
            </h1>
            <p className="mt-1 font-mono text-xs text-muted-foreground">
              Brief: "{session?.brief ?? "No brief specified"}"
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-3">
            {session?.status && <StatusChip status={session.status} />}
            <button
              onClick={exportJson}
              className="rounded-sm border border-border bg-card px-3 py-1.5 font-mono text-[12px] font-medium text-foreground transition-colors hover:bg-accent hover:text-accent-foreground"
            >
              Export JSON ↓
            </button>
          </div>
        </div>

        {/* Executive Summary Cards */}
        <div className="mt-6 grid gap-px overflow-hidden rounded-sm border border-border bg-border sm:grid-cols-2 lg:grid-cols-4">
          <div className="bg-card p-4">
            <span className="font-mono text-[11px] text-muted-foreground">MANDATE BUDGET</span>
            <div className="mt-1 font-mono text-lg font-semibold text-foreground">
              {formatINR(mandateBudget)}
            </div>
            <span className="font-mono text-[10px] text-muted-foreground">{mandateBudget} paise cap</span>
          </div>

          <div className="bg-card p-4">
            <span className="font-mono text-[11px] text-muted-foreground">ORDER TOTAL</span>
            <div className="mt-1 font-mono text-lg font-semibold text-primary">
              {primaryOrder ? formatINR(primaryOrder.amount_paise) : "₹0.00"}
            </div>
            <span className="font-mono text-[10px] text-muted-foreground">
              {primaryOrder ? `${primaryOrder.amount_paise} paise` : "No order created"}
            </span>
          </div>

          <div className="bg-card p-4">
            <span className="font-mono text-[11px] text-muted-foreground">RAZORPAY ORDER</span>
            <div className="mt-1 font-mono text-sm font-semibold truncate text-foreground">
              {primaryOrder?.razorpay_order_id ?? "—"}
            </div>
            <span className="font-mono text-[10px] text-muted-foreground">
              Status: {primaryOrder?.status ?? "none"}
            </span>
          </div>

          <div className="bg-card p-4">
            <span className="font-mono text-[11px] text-muted-foreground">TOTAL EVENTS</span>
            <div className="mt-1 font-mono text-lg font-semibold text-foreground">
              {timeline.length}
            </div>
            <span className="font-mono text-[10px] text-muted-foreground">
              {decisions.length} policy evaluations
            </span>
          </div>
        </div>

        {/* Outcome Rationale Banner */}
        {session?.outcome && (
          <div className="mt-6 rounded-sm border border-border bg-card p-4">
            <span className="font-mono text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
              Session Outcome
            </span>
            <p className="mt-1 font-mono text-xs leading-relaxed text-foreground">
              {session.outcome}
            </p>
          </div>
        )}

        <div className="mt-8 grid gap-8 lg:grid-cols-[1fr_340px]">
          {/* Main Audit Feed */}
          <section>
            <div className="flex flex-wrap items-center justify-between gap-3 pb-3">
              <SectionLabel>{filteredTimeline.length} events recorded</SectionLabel>

              {/* Filter Tabs */}
              <div className="flex flex-wrap gap-1 rounded-sm border border-border bg-card p-1">
                {(["all", "message", "policy", "audit", "payment"] as FilterType[]).map((f) => {
                  const count =
                    f === "all" ? timeline.length : timeline.filter((i) => i.kind === f).length;
                  return (
                    <button
                      key={f}
                      onClick={() => setFilter(f)}
                      className={`rounded-xs px-2.5 py-1 font-mono text-[11px] capitalize transition-colors ${
                        filter === f
                          ? "bg-primary text-primary-foreground font-semibold"
                          : "text-muted-foreground hover:bg-accent hover:text-foreground"
                      }`}
                    >
                      {f} ({count})
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Timeline List */}
            {filteredTimeline.length === 0 ? (
              <div className="rounded-sm border border-border bg-card p-8 text-center font-mono text-xs text-muted-foreground">
                No events match the selected filter.
              </div>
            ) : (
              <div className="space-y-2">
                {filteredTimeline.map((item) => {
                  const isExpanded = !!expandedItems[item.id];
                  const hasDetails = item.detail && Object.keys(item.detail).length > 0;
                  const formattedTime = new Date(item.ts).toLocaleTimeString("en-IN", {
                    hour12: false,
                    hour: "2-digit",
                    minute: "2-digit",
                    second: "2-digit",
                  });

                  return (
                    <div
                      key={item.id}
                      className={`group rounded-sm border transition-colors bg-card ${
                        item.verdict === "deny"
                          ? "border-deny/40 bg-deny/5"
                          : item.verdict === "escalate"
                          ? "border-warning/40 bg-warning/5"
                          : "border-border hover:border-border/80"
                      }`}
                    >
                      <div className="flex items-start justify-between gap-3 p-3 font-mono text-[12px]">
                        <div className="flex flex-1 flex-wrap items-center gap-2">
                          <span className="text-muted-foreground text-[11px]">{formattedTime}</span>

                          {/* Actor Badge */}
                          <span className="rounded-xs border border-border bg-muted px-1.5 py-0.5 uppercase text-[10px] font-semibold text-foreground">
                            {item.actor}
                          </span>

                          {/* Event Kind Badge */}
                          <span className="rounded-xs border border-border px-1.5 py-0.5 text-[10px] text-muted-foreground">
                            {item.badge}
                          </span>

                          {/* Policy Verdict Badge */}
                          {item.verdict && (
                            <span
                              className={`rounded-xs px-1.5 py-0.5 text-[10px] font-semibold uppercase ${
                                item.verdict === "allow"
                                  ? "bg-allow/10 border border-allow/30 text-allow"
                                  : item.verdict === "deny"
                                  ? "bg-deny/10 border border-deny/30 text-deny"
                                  : "bg-warning/10 border border-warning/30 text-warning"
                              }`}
                            >
                              {item.verdict}
                            </span>
                          )}
                        </div>

                        {hasDetails && (
                          <button
                            onClick={() => toggleExpand(item.id)}
                            className="font-mono text-[11px] text-primary hover:underline"
                          >
                            {isExpanded ? "hide json" : "payload →"}
                          </button>
                        )}
                      </div>

                      <div className="px-3 pb-3 font-mono text-xs text-foreground leading-relaxed">
                        {item.summary}
                      </div>

                      {/* Expandable JSON Detail Drawer */}
                      {isExpanded && hasDetails && (
                        <div className="border-t border-border/60 bg-muted/40 p-3 font-mono text-[11px]">
                          <pre className="overflow-x-auto text-muted-foreground">
                            {JSON.stringify(item.detail, null, 2)}
                          </pre>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </section>

          {/* Sidebar Panel: Order Details & Cart */}
          <aside className="space-y-6">
            <div className="rounded-sm border border-border bg-card p-5">
              <SectionLabel>order breakdown</SectionLabel>
              {cartLines.length === 0 ? (
                <p className="font-mono text-xs text-muted-foreground">No cart items recorded.</p>
              ) : (
                <div className="space-y-3 font-mono text-xs">
                  {cartLines.map((line) => (
                    <div key={line.sku} className="flex justify-between items-start border-b border-border/40 pb-2">
                      <div>
                        <div className="font-semibold text-foreground">{line.title}</div>
                        <div className="text-[10px] text-muted-foreground">
                          {line.sku} · Qty: {line.qty}
                        </div>
                      </div>
                      <div className="font-semibold text-primary">
                        {formatINR(line.unit_price_paise * line.qty)}
                      </div>
                    </div>
                  ))}

                  <div className="pt-2 space-y-1 text-[11px]">
                    <div className="flex justify-between text-muted-foreground">
                      <span>Subtotal:</span>
                      <span>{formatINR(primaryOrder?.subtotal_paise ?? 0)}</span>
                    </div>
                    {Boolean(primaryOrder?.discount_paise) && (
                      <div className="flex justify-between text-allow">
                        <span>Discount:</span>
                        <span>-{formatINR(primaryOrder?.discount_paise ?? 0)}</span>
                      </div>
                    )}
                    <div className="flex justify-between font-bold text-foreground text-xs pt-2 border-t border-border">
                      <span>Total Amount:</span>
                      <span className="text-primary">{formatINR(primaryOrder?.amount_paise ?? 0)}</span>
                    </div>
                  </div>
                </div>
              )}
            </div>

            {/* Payment Link details if generated */}
            {primaryOrder?.razorpay_link_url && (
              <div className="rounded-sm border border-border bg-card p-5 font-mono text-xs">
                <SectionLabel>checkout link</SectionLabel>
                <p className="text-muted-foreground text-[11px] mb-3">
                  Razorpay test mode payment link generated for agent settlement:
                </p>
                <a
                  href={primaryOrder.razorpay_link_url}
                  target="_blank"
                  rel="noreferrer"
                  className="block text-center rounded-sm bg-primary px-3 py-2 text-xs font-semibold text-primary-foreground transition-opacity hover:opacity-90"
                >
                  Pay via Razorpay →
                </a>
              </div>
            )}
          </aside>
        </div>
      </main>
    </ConsoleShell>
  );
}
