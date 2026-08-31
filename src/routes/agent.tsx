import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useMemo, useState } from "react";
import { toast } from "sonner";

import { ConsoleShell, SectionLabel, StatusChip, VerdictChip } from "@/components/console-chrome";
import { runAgentSessionFn } from "@/lib/agent.functions";
import { getSessionBundle } from "@/lib/public-data.functions";
import { formatINR, pct } from "@/lib/money";

interface AgentSearchParams {
  sessionId?: string;
}

export const Route = createFileRoute("/agent")({
  validateSearch: (search: Record<string, unknown>): AgentSearchParams => ({
    sessionId: typeof search.sessionId === "string" ? search.sessionId : undefined,
  }),
  head: () => ({
    meta: [
      { title: "Agent theatre — run a policy-gated agent negotiation" },
      {
        name: "description",
        content:
          "Watch a buyer agent and a seller agent negotiate under spend mandates and policy caps, streaming live dialogue, policy verdicts, and Razorpay test settlements.",
      },
      { property: "og:title", content: "Agent theatre — 3-pane agent negotiation & policy console" },
      {
        property: "og:description",
        content: "Buyer agent, seller agent, policy gate and Razorpay test mode in a 3-pane operations console.",
      },
    ],
  }),
  component: AgentPage,
});

const MODES = [
  { id: "happy", label: "Happy path", hint: "Cart fits the mandate. Upsell accepted, order created." },
  { id: "overcap", label: "Over-cap", hint: "Brief exceeds the mandate. Policy blocks, agent re-plans." },
  { id: "payment_failure", label: "Gateway failure", hint: "Razorpay rejects the charge. Recovery is audited." },
] as const;

type ModeId = (typeof MODES)[number]["id"];

const PRESETS = [
  { brief: "Birthday gift bundle — candle, stationery & chocolates", budget: 3500 },
  { brief: "Diwali gifting for 3 client founders — premium but tasteful", budget: 9000 },
  { brief: "Ten-person team offsite hampers, all handcrafted", budget: 12000 },
];

type TranscriptFilter = "all" | "dialogue" | "policy" | "settlement";

interface UnifiedEvent {
  id: string;
  ts: string;
  seq?: number;
  turn?: number;
  kind: "message" | "policy" | "settlement" | "audit";
  actor: "buyer" | "seller" | "policy" | "system" | "gateway" | string;
  badge: string;
  verdict?: "allow" | "deny" | "escalate";
  summary: string;
  detail: Record<string, unknown>;
}

function AgentPage() {
  const navigate = useNavigate();
  const search = Route.useSearch();
  const [activeSessionId, setActiveSessionId] = useState<string | null>(search.sessionId ?? null);

  const [brief, setBrief] = useState(PRESETS[0]!.brief);
  const [budget, setBudget] = useState(PRESETS[0]!.budget);
  const [mode, setMode] = useState<ModeId>("happy");

  const runFn = useServerFn(runAgentSessionFn);

  const runMutation = useMutation({
    mutationFn: () => runFn({ data: { brief, budgetPaise: budget * 100, mode } }),
    onSuccess: (res) => {
      setActiveSessionId(res.sessionId);
      navigate({
        search: (prev: Record<string, unknown>) => ({ ...prev, sessionId: res.sessionId }),
        replace: true,
      });
      toast.success(`Session ${res.status.replace(/_/g, " ")}`, {
        description: "Agent theatre is streaming the negotiation trail.",
      });
    },
    onError: (error: unknown) => {
      toast.error("The run could not complete", {
        description: error instanceof Error ? error.message : "Unknown error",
      });
    },
  });

  const { data: bundle, isLoading: isBundleLoading } = useQuery({
    queryKey: ["session-bundle", activeSessionId],
    queryFn: () => getSessionBundle({ data: { sessionId: activeSessionId! } }),
    enabled: !!activeSessionId,
    refetchInterval: (query) => {
      const status = query.state.data?.session?.status;
      return status === "running" ? 1200 : false;
    },
  });

  const handleStartNewRun = () => {
    setActiveSessionId(null);
    navigate({
      search: (prev: Record<string, unknown>) => {
        const next = { ...prev };
        delete next.sessionId;
        return next;
      },
      replace: true,
    });
  };

  return (
    <ConsoleShell>
      <main className="mx-auto max-w-[1520px] px-4 py-8 sm:px-6">
        {/* If no session is active and not currently executing, show Entry Setup Form */}
        {!activeSessionId && !runMutation.isPending && (
          <MandateSetupForm
            brief={brief}
            setBrief={setBrief}
            budget={budget}
            setBudget={setBudget}
            mode={mode}
            setMode={setMode}
            isPending={runMutation.isPending}
            onRun={() => runMutation.mutate()}
          />
        )}

        {/* If currently running or session active, render 3-Pane Theatre */}
        {(activeSessionId || runMutation.isPending) && (
          <TheatreView
            sessionId={activeSessionId}
            isPending={runMutation.isPending}
            isLoadingBundle={isBundleLoading}
            bundle={bundle}
            onNewRun={handleStartNewRun}
            onReRun={() => runMutation.mutate()}
          />
        )}
      </main>
    </ConsoleShell>
  );
}

/* -------------------------------------------------------------------------- */
/* ENTRY FORM: MANDATE SETUP                                                  */
/* -------------------------------------------------------------------------- */

interface MandateSetupFormProps {
  brief: string;
  setBrief: (v: string) => void;
  budget: number;
  setBudget: (v: number) => void;
  mode: ModeId;
  setMode: (v: ModeId) => void;
  isPending: boolean;
  onRun: () => void;
}

function MandateSetupForm({
  brief,
  setBrief,
  budget,
  setBudget,
  mode,
  setMode,
  isPending,
  onRun,
}: MandateSetupFormProps) {
  return (
    <div className="mx-auto max-w-5xl py-6">
      <div className="flex flex-wrap items-center justify-between gap-4 border-b border-border pb-6">
        <div>
          <div className="inline-flex items-center gap-2 rounded-sm border border-border bg-card px-2.5 py-1 font-mono text-[11px] text-muted-foreground">
            <span className="size-1.5 rounded-full bg-primary" />
            theatre configuration
          </div>
          <h1 className="mt-3 text-3xl font-bold tracking-tight text-foreground">Agent theatre</h1>
          <p className="mt-2 max-w-2xl text-sm text-muted-foreground">
            Configure the buyer agent's brief and spend mandate. Once launched, two autonomous agents negotiate over the
            merchant catalog bounded by policy caps and Razorpay test settlement.
          </p>
        </div>
      </div>

      <div className="mt-8 grid gap-6 lg:grid-cols-[minmax(0,1fr)_360px]">
        {/* Left column: Mandate & Scenario Inputs */}
        <section className="rounded-sm border border-border bg-card p-6">
          <SectionLabel>buyer mandate</SectionLabel>

          <label className="block font-mono text-[12px] text-muted-foreground" htmlFor="brief">
            purchase brief
          </label>
          <textarea
            id="brief"
            value={brief}
            onChange={(e) => setBrief(e.target.value)}
            rows={3}
            maxLength={400}
            placeholder="Describe what the buyer agent should purchase..."
            className="mt-2 w-full resize-none rounded-sm border border-input bg-background px-3.5 py-2.5 font-mono text-sm text-foreground outline-none transition-colors focus:border-ring"
          />

          <div className="mt-6 flex items-baseline justify-between">
            <label className="font-mono text-[12px] text-muted-foreground" htmlFor="budget">
              mandate budget cap
            </label>
            <span className="font-mono text-lg font-bold text-primary">{formatINR(budget * 100)}</span>
          </div>
          <input
            id="budget"
            type="range"
            min={500}
            max={20000}
            step={250}
            value={budget}
            onChange={(e) => setBudget(Number(e.target.value))}
            className="mt-3 w-full accent-primary"
          />
          <div className="mt-1 flex justify-between font-mono text-[10px] text-muted-foreground">
            <span>₹500 (min)</span>
            <span>₹10,000</span>
            <span>₹20,000 (max)</span>
          </div>

          <div className="mt-8">
            <SectionLabel>scenario mode</SectionLabel>
            <div className="grid gap-2.5 sm:grid-cols-3">
              {MODES.map((m) => (
                <button
                  key={m.id}
                  type="button"
                  onClick={() => setMode(m.id)}
                  className={`rounded-sm border p-3.5 text-left transition-all ${
                    mode === m.id
                      ? "border-primary bg-primary/10 ring-1 ring-primary/40"
                      : "border-border bg-background hover:border-border/80 hover:bg-accent"
                  }`}
                >
                  <div className="flex items-center justify-between">
                    <span className="font-mono text-[12px] font-semibold text-foreground">{m.label}</span>
                    {mode === m.id && <span className="size-1.5 rounded-full bg-primary" />}
                  </div>
                  <div className="mt-1.5 text-[11px] leading-snug text-muted-foreground">{m.hint}</div>
                </button>
              ))}
            </div>
          </div>

          <button
            type="button"
            disabled={isPending || brief.trim().length < 4}
            onClick={onRun}
            className="mt-8 w-full rounded-sm bg-primary px-4 py-3.5 font-mono text-[13px] font-semibold uppercase tracking-wider text-primary-foreground transition-opacity hover:opacity-90 disabled:opacity-50"
          >
            {isPending ? "Negotiating & evaluating policy…" : "Launch Agent Theatre →"}
          </button>
          <div className="mt-3 flex items-center justify-between font-mono text-[11px] text-muted-foreground">
            <span>Razorpay test mode (no real money moves)</span>
            <span>100% Policy Bound</span>
          </div>
        </section>

        {/* Right column: Presets & Guardrails */}
        <aside className="space-y-6">
          <div className="rounded-sm border border-border bg-card p-5">
            <SectionLabel>quick presets</SectionLabel>
            <div className="space-y-2">
              {PRESETS.map((p) => (
                <button
                  key={p.brief}
                  type="button"
                  onClick={() => {
                    setBrief(p.brief);
                    setBudget(p.budget);
                  }}
                  className="group w-full rounded-sm border border-border bg-background p-3 text-left text-[12px] transition-colors hover:border-primary/50 hover:bg-accent"
                >
                  <div className="line-clamp-2 text-foreground group-hover:text-primary">{p.brief}</div>
                  <span className="mt-1.5 block font-mono text-[11px] font-semibold text-primary">
                    {formatINR(p.budget * 100)} cap
                  </span>
                </button>
              ))}
            </div>
          </div>

          <div className="rounded-sm border border-border bg-card p-5">
            <SectionLabel>enforced guardrails</SectionLabel>
            <ul className="space-y-2.5 font-mono text-[11px] leading-relaxed text-muted-foreground">
              <li className="flex items-start gap-2">
                <span className="text-allow">✓</span> Order total must stay inside mandate budget.
              </li>
              <li className="flex items-start gap-2">
                <span className="text-allow">✓</span> Merchant per-item &amp; per-order caps enforced.
              </li>
              <li className="flex items-start gap-2">
                <span className="text-allow">✓</span> Category allowlist check (off-list denied).
              </li>
              <li className="flex items-start gap-2">
                <span className="text-allow">✓</span> Seller discounts capped by merchant authority.
              </li>
              <li className="flex items-start gap-2">
                <span className="text-allow">✓</span> Policy block triggers replanning, not blind retry.
              </li>
            </ul>
            <Link
              to="/merchant"
              className="mt-4 inline-block font-mono text-[11px] text-primary underline-offset-4 hover:underline"
            >
              inspect merchant caps &amp; rules →
            </Link>
          </div>
        </aside>
      </div>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* THEATRE VIEW (3-PANE OPERATIONS CONSOLE)                                   */
/* -------------------------------------------------------------------------- */

interface TheatreViewProps {
  sessionId: string | null;
  isPending: boolean;
  isLoadingBundle: boolean;
  bundle: Awaited<ReturnType<typeof getSessionBundle>> | undefined;
  onNewRun: () => void;
  onReRun: () => void;
}

function TheatreView({
  sessionId,
  isPending,
  isLoadingBundle,
  bundle,
  onNewRun,
  onReRun,
}: TheatreViewProps) {
  const [transcriptFilter, setTranscriptFilter] = useState<TranscriptFilter>("all");
  const [expandedPayloads, setExpandedPayloads] = useState<Record<string, boolean>>({});

  const session = bundle?.session;
  const messages = bundle?.messages ?? [];
  const decisions = bundle?.decisions ?? [];
  const events = bundle?.events ?? [];
  const orders = bundle?.orders ?? [];

  const primaryOrder = orders[0];
  const cartLines = (primaryOrder?.cart as Array<{
    sku: string;
    title: string;
    qty: number;
    unit_price_paise: number;
    category?: string;
  }>) ?? [];

  const mandateBudgetPaise =
    (session?.mandate as { budget_paise?: number })?.budget_paise ?? 350000;
  const mandateMode =
    (session?.mandate as { mode?: string })?.mode ?? "happy";

  const orderSubtotalPaise = primaryOrder?.subtotal_paise ?? 0;
  const orderDiscountPaise = primaryOrder?.discount_paise ?? 0;
  const orderAmountPaise = primaryOrder?.amount_paise ?? 0;

  // Calculate spend meter percentage & headroom
  const spendPercent = pct(orderAmountPaise, mandateBudgetPaise);
  const headroomPaise = Math.max(0, mandateBudgetPaise - orderAmountPaise);
  const isOverCap = orderAmountPaise > mandateBudgetPaise;
  const isBlocked = session?.status === "blocked" || primaryOrder?.status === "blocked";
  const isFailed = session?.status === "failed" || primaryOrder?.status === "failed";

  // Build unified chronological timeline for Live Transcript
  const timeline = useMemo(() => {
    const items: UnifiedEvent[] = [];

    for (const m of messages) {
      items.push({
        id: `msg-${m.id}`,
        ts: m.created_at,
        turn: m.turn,
        kind: "message",
        actor: m.sender,
        badge: m.kind,
        summary: m.body,
        detail: (m.payload as Record<string, unknown>) ?? {},
      });
    }

    for (const d of decisions) {
      items.push({
        id: `dec-${d.id}`,
        ts: d.created_at,
        kind: "policy",
        actor: "policy",
        badge: d.rule_name,
        verdict: d.verdict as "allow" | "deny" | "escalate",
        summary: `${d.action}: ${d.reason}`,
        detail: {
          action: d.action,
          rule: d.rule_name,
          inputs: d.inputs,
          verdict: d.verdict,
        },
      });
    }

    for (const e of events) {
      const isSettlement =
        e.event_type.startsWith("razorpay.") ||
        e.event_type.startsWith("payment.") ||
        e.event_type.startsWith("webhook.");
      items.push({
        id: `evt-${e.id}`,
        ts: e.created_at,
        seq: e.seq,
        kind: isSettlement ? "settlement" : "audit",
        actor: isSettlement ? "gateway" : e.actor,
        badge: e.event_type,
        summary: e.summary,
        detail: (e.detail as Record<string, unknown>) ?? {},
      });
    }

    return items.sort((a, b) => new Date(a.ts).getTime() - new Date(b.ts).getTime());
  }, [messages, decisions, events]);

  const filteredTimeline = useMemo(() => {
    if (transcriptFilter === "all") return timeline;
    if (transcriptFilter === "dialogue") return timeline.filter((i) => i.kind === "message");
    if (transcriptFilter === "policy") return timeline.filter((i) => i.kind === "policy");
    if (transcriptFilter === "settlement") return timeline.filter((i) => i.kind === "settlement");
    return timeline;
  }, [timeline, transcriptFilter]);

  const togglePayload = (id: string) => {
    setExpandedPayloads((prev) => ({ ...prev, [id]: !prev[id] }));
  };

  const exportJson = () => {
    if (!bundle) return;
    const jsonString = `data:text/json;charset=utf-8,${encodeURIComponent(JSON.stringify(bundle, null, 2))}`;
    const anchor = document.createElement("a");
    anchor.setAttribute("href", jsonString);
    anchor.setAttribute("download", `agent-theatre-session-${sessionId?.slice(0, 8) ?? "run"}.json`);
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
  };

  // Buyer-specific extracted data
  const buyerMessages = messages.filter((m) => m.sender === "buyer");
  const initialProposal = messages.find((m) => m.sender === "buyer" && m.kind === "propose");
  const initialCart =
    (initialProposal?.payload as { cart?: Array<{ sku: string; title: string; qty: number; unit_price_paise: number }> })
      ?.cart ?? cartLines;

  // Seller-specific extracted data
  const sellerCounter = messages.find((m) => m.sender === "seller" && m.kind === "counter");
  const sellerCounterPayload = (sellerCounter?.payload as {
    add_sku?: string;
    discount_bps?: number;
    discount_paise?: number;
    new_total_paise?: number;
  }) ?? {};

  return (
    <div className="space-y-6">
      {/* Top Operations Bar */}
      <div className="flex flex-wrap items-center justify-between gap-4 rounded-sm border border-border bg-card px-5 py-3.5">
        <div className="flex flex-wrap items-center gap-3">
          <div className="flex items-center gap-2 font-mono text-[12px] text-muted-foreground">
            <span className="size-2 rounded-full bg-primary animate-pulse" />
            <span className="font-semibold text-foreground uppercase tracking-wider">theatre console</span>
            <span>/</span>
            <span className="text-foreground">
              {sessionId ? `session-${sessionId.slice(0, 8)}` : "executing…"}
            </span>
          </div>

          <span className="rounded-sm border border-border bg-background px-2 py-0.5 font-mono text-[10px] uppercase text-muted-foreground">
            mode: {mandateMode}
          </span>

          {session?.status ? (
            <StatusChip status={session.status} />
          ) : isPending ? (
            <span className="rounded-sm border border-primary/40 bg-primary/10 px-2 py-0.5 font-mono text-[10px] uppercase text-primary animate-pulse">
              running negotiation…
            </span>
          ) : null}
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <button
            onClick={onNewRun}
            className="rounded-sm border border-border bg-background px-3 py-1.5 font-mono text-[11px] text-foreground transition-colors hover:bg-accent"
          >
            ← New Mandate
          </button>
          <button
            onClick={onReRun}
            disabled={isPending}
            className="rounded-sm border border-border bg-background px-3 py-1.5 font-mono text-[11px] text-foreground transition-colors hover:bg-accent disabled:opacity-50"
          >
            ↻ Re-run
          </button>
          {sessionId && (
            <Link
              to="/audit/$sessionId"
              params={{ sessionId }}
              className="rounded-sm border border-primary/40 bg-primary/10 px-3 py-1.5 font-mono text-[11px] font-semibold text-primary transition-colors hover:bg-primary/20"
            >
              Full Audit Trail →
            </Link>
          )}
          {bundle && (
            <button
              onClick={exportJson}
              className="rounded-sm border border-border bg-background px-3 py-1.5 font-mono text-[11px] text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
            >
              Export JSON ↓
            </button>
          )}
        </div>
      </div>

      {/* Policy & Cap Meter (HUD) */}
      <section className="rounded-sm border border-border bg-card p-5">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border/80 pb-3 font-mono text-[11px]">
          <div className="flex items-center gap-2 font-semibold uppercase tracking-wider text-muted-foreground">
            <span>POLICY &amp; SPEND CAP METER</span>
            <span className="text-[10px] text-muted-foreground/60">|</span>
            <span className="text-foreground">
              Brief: "{session?.brief ?? "Executing shopping mandate..."}"
            </span>
          </div>

          <div className="flex items-center gap-2">
            <span className="text-muted-foreground">Policy Gate:</span>
            {isBlocked ? (
              <span className="rounded-xs border border-deny/40 bg-deny/10 px-2 py-0.5 font-bold uppercase text-deny text-[10px]">
                DENIED / RE-PLAN
              </span>
            ) : isFailed ? (
              <span className="rounded-xs border border-deny/40 bg-deny/10 px-2 py-0.5 font-bold uppercase text-deny text-[10px]">
                GATEWAY FAILED
              </span>
            ) : (
              <span className="rounded-xs border border-allow/40 bg-allow/10 px-2 py-0.5 font-bold uppercase text-allow text-[10px]">
                ALLOW (WITHIN BOUNDS)
              </span>
            )}
          </div>
        </div>

        {/* Spend Metrics Grid */}
        <div className="mt-4 grid gap-px overflow-hidden rounded-sm border border-border bg-border grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 font-mono">
          <div className="bg-card p-3">
            <span className="text-[10px] text-muted-foreground uppercase">Mandate Cap</span>
            <div className="mt-1 text-sm font-bold text-foreground">
              {formatINR(mandateBudgetPaise)}
            </div>
            <span className="text-[10px] text-muted-foreground">{mandateBudgetPaise} paise</span>
          </div>

          <div className="bg-card p-3">
            <span className="text-[10px] text-muted-foreground uppercase">Order Subtotal</span>
            <div className="mt-1 text-sm font-semibold text-foreground">
              {formatINR(orderSubtotalPaise)}
            </div>
            <span className="text-[10px] text-muted-foreground">{cartLines.length} line items</span>
          </div>

          <div className="bg-card p-3">
            <span className="text-[10px] text-muted-foreground uppercase">Seller Discount</span>
            <div className="mt-1 text-sm font-semibold text-allow">
              {orderDiscountPaise > 0 ? `−${formatINR(orderDiscountPaise)}` : "₹0.00"}
            </div>
            <span className="text-[10px] text-muted-foreground">
              {sellerCounterPayload.discount_bps ? `${sellerCounterPayload.discount_bps / 100}% off` : "0%"}
            </span>
          </div>

          <div className="bg-card p-3">
            <span className="text-[10px] text-muted-foreground uppercase">Final Spend</span>
            <div
              className={`mt-1 text-sm font-bold ${
                isOverCap || isBlocked ? "text-deny" : "text-primary"
              }`}
            >
              {formatINR(orderAmountPaise)}
            </div>
            <span className="text-[10px] text-muted-foreground">{spendPercent}% of cap</span>
          </div>

          <div className="bg-card p-3">
            <span className="text-[10px] text-muted-foreground uppercase">Remaining Headroom</span>
            <div className="mt-1 text-sm font-semibold text-foreground">
              {formatINR(headroomPaise)}
            </div>
            <span className="text-[10px] text-muted-foreground">
              {headroomPaise > 0 ? "Under mandate" : "Cap reached"}
            </span>
          </div>

          <div className="bg-card p-3">
            <span className="text-[10px] text-muted-foreground uppercase">Settlement Order</span>
            <div className="mt-1 text-xs font-semibold text-foreground truncate">
              {primaryOrder?.razorpay_order_id ?? (isBlocked ? "None (Blocked)" : isFailed ? "Failed" : "—")}
            </div>
            <span className="text-[10px] text-muted-foreground">
              Status: {primaryOrder?.status ?? "none"}
            </span>
          </div>
        </div>

        {/* Visual Cap Progress Meter */}
        <div className="mt-4 space-y-1.5">
          <div className="flex justify-between font-mono text-[10px] text-muted-foreground">
            <span>₹0 (0%)</span>
            <span>50%</span>
            <span className="font-semibold text-foreground">100% MANDATE CAP ({formatINR(mandateBudgetPaise)})</span>
          </div>
          <div className="relative h-2.5 w-full overflow-hidden rounded-xs border border-border bg-muted/60">
            <div
              style={{ width: `${Math.min(100, Math.max(2, spendPercent))}%` }}
              className={`h-full transition-all duration-500 ${
                isBlocked || isOverCap
                  ? "bg-deny"
                  : isFailed
                  ? "bg-warning"
                  : "bg-allow"
              }`}
            />
            {/* 100% Marker tick */}
            <div className="absolute right-0 top-0 bottom-0 w-0.5 bg-foreground/40" />
          </div>
          {session?.outcome && (
            <p className="pt-1 font-mono text-[11px] leading-relaxed text-muted-foreground">
              <span className="font-semibold text-foreground">Outcome:</span> {session.outcome}
            </p>
          )}
        </div>
      </section>

      {/* 3-Pane Theatre Grid */}
      <div className="grid gap-6 lg:grid-cols-[1fr_1.35fr_1fr] items-start">
        {/* ================================================================== */}
        {/* PANE 1: BUYER AGENT                                                */}
        {/* ================================================================== */}
        <div className="rounded-sm border border-border bg-card p-5 space-y-5">
          <div className="border-b border-border/80 pb-3">
            <div className="flex items-center justify-between">
              <div className="font-mono text-sm font-bold uppercase tracking-wider text-primary">
                BUYER AGENT
              </div>
              <span className="rounded-xs border border-primary/30 bg-primary/10 px-1.5 py-0.5 font-mono text-[10px] uppercase text-primary">
                Principal Mandate
              </span>
            </div>
            <p className="mt-1 font-mono text-[11px] text-muted-foreground">
              Autonomous agent acting with spend limits &amp; catalog discovery.
            </p>
          </div>

          {/* Discovery & Manifest Status */}
          <div className="rounded-xs border border-border bg-background p-3 font-mono text-[11px] space-y-1.5">
            <div className="flex items-center justify-between">
              <span className="text-muted-foreground">Discovery Source:</span>
              <span className="text-foreground">/api/public/agent/catalog</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-muted-foreground">Capabilities:</span>
              <span className="text-allow">quote, negotiate, order</span>
            </div>
          </div>

          {/* Planned Cart Breakdown */}
          <div>
            <SectionLabel>chosen cart items</SectionLabel>
            {cartLines.length === 0 ? (
              <div className="rounded-xs border border-border bg-background p-4 text-center font-mono text-[11px] text-muted-foreground">
                {isPending ? "Buyer agent is querying catalog…" : "No cart items selected."}
              </div>
            ) : (
              <div className="space-y-2 font-mono text-[11px]">
                {cartLines.map((item) => (
                  <div
                    key={item.sku}
                    className="flex items-start justify-between rounded-xs border border-border bg-background p-2.5"
                  >
                    <div>
                      <div className="font-semibold text-foreground">{item.title}</div>
                      <div className="text-[10px] text-muted-foreground">
                        {item.sku} · Qty: {item.qty} {item.category ? `· ${item.category}` : ""}
                      </div>
                    </div>
                    <div className="text-right">
                      <div className="font-semibold text-primary">
                        {formatINR(item.unit_price_paise * item.qty)}
                      </div>
                      <div className="text-[10px] text-muted-foreground">
                        @{formatINR(item.unit_price_paise)}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Buyer Policy Guardrails Evaluation */}
          <div>
            <SectionLabel>buyer guardrails evaluated</SectionLabel>
            <div className="space-y-1.5 font-mono text-[11px]">
              <GuardrailRow
                name="mandate_budget"
                rule={`Subtotal <= ${formatINR(mandateBudgetPaise)}`}
                verdict={isOverCap || isBlocked ? "deny" : "allow"}
                reason={
                  isOverCap || isBlocked
                    ? `Cart (${formatINR(orderSubtotalPaise)}) exceeded mandate budget`
                    : "Within authorized principal budget"
                }
              />
              <GuardrailRow
                name="category_allowlist"
                rule="Allowed: home, wellness, stationery, gourmet"
                verdict="allow"
                reason="All selected SKUs match allowed categories"
              />
              <GuardrailRow
                name="item_price_cap"
                rule="Max single item <= ₹10,000"
                verdict="allow"
                reason="Item prices strictly within merchant console cap"
              />
            </div>
          </div>

          {/* Buyer Agent Reasoning Log */}
          <div>
            <SectionLabel>buyer strategy &amp; rationale</SectionLabel>
            <div className="space-y-2">
              {buyerMessages.map((m) => (
                <div
                  key={m.id}
                  className="rounded-xs border border-border/80 bg-background/80 p-2.5 font-mono text-[11px] leading-relaxed"
                >
                  <div className="flex items-center justify-between text-[10px] text-muted-foreground mb-1">
                    <span className="font-semibold uppercase text-primary">Turn {m.turn} · {m.kind}</span>
                    <span>{new Date(m.created_at).toLocaleTimeString("en-IN", { hour12: false })}</span>
                  </div>
                  <div className="text-foreground">{m.body}</div>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* ================================================================== */}
        {/* PANE 2: LIVE TRANSCRIPT (SEQUENCED TIMELINE)                       */}
        {/* ================================================================== */}
        <div className="rounded-sm border border-border bg-card p-5 space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border/80 pb-3">
            <div>
              <div className="flex items-center gap-2">
                <span className="font-mono text-sm font-bold uppercase tracking-wider text-foreground">
                  LIVE TRANSCRIPT
                </span>
                <span className="size-1.5 rounded-full bg-allow" />
              </div>
              <p className="mt-0.5 font-mono text-[11px] text-muted-foreground">
                Sequenced agent negotiation stream &amp; policy decisions.
              </p>
            </div>

            {/* Filter Tabs */}
            <div className="flex flex-wrap gap-1 rounded-xs border border-border bg-background p-0.5 font-mono text-[10px]">
              {(["all", "dialogue", "policy", "settlement"] as TranscriptFilter[]).map((f) => (
                <button
                  key={f}
                  onClick={() => setTranscriptFilter(f)}
                  className={`rounded-xs px-2 py-0.5 capitalize transition-colors ${
                    transcriptFilter === f
                      ? "bg-primary text-primary-foreground font-semibold"
                      : "text-muted-foreground hover:text-foreground"
                  }`}
                >
                  {f}
                </button>
              ))}
            </div>
          </div>

          {/* Timeline Event Feed */}
          {filteredTimeline.length === 0 ? (
            <div className="rounded-sm border border-border bg-background p-8 text-center font-mono text-xs text-muted-foreground">
              {isPending ? "Negotiation starting..." : "No events match this filter."}
            </div>
          ) : (
            <div className="space-y-2.5 max-h-[820px] overflow-y-auto pr-1">
              {filteredTimeline.map((item) => {
                const isExpanded = !!expandedPayloads[item.id];
                const hasDetails = item.detail && Object.keys(item.detail).length > 0;
                const formattedTime = new Date(item.ts).toLocaleTimeString("en-IN", {
                  hour12: false,
                  hour: "2-digit",
                  minute: "2-digit",
                  second: "2-digit",
                });

                // Actor styling
                const actorTag =
                  item.actor === "buyer"
                    ? "border-primary/40 bg-primary/10 text-primary"
                    : item.actor === "seller"
                    ? "border-sky-500/40 bg-sky-500/10 text-sky-400"
                    : item.actor === "policy"
                    ? "border-amber-500/40 bg-amber-500/10 text-amber-400"
                    : "border-border bg-muted text-muted-foreground";

                return (
                  <div
                    key={item.id}
                    className={`rounded-sm border transition-colors bg-background ${
                      item.verdict === "deny"
                        ? "border-deny/40 bg-deny/5"
                        : item.verdict === "escalate"
                        ? "border-warning/40 bg-warning/5"
                        : item.verdict === "allow"
                        ? "border-allow/30 hover:border-allow/50"
                        : "border-border hover:border-border/80"
                    }`}
                  >
                    <div className="flex items-start justify-between gap-2 p-2.5 font-mono text-[11px]">
                      <div className="flex flex-wrap items-center gap-1.5">
                        <span className="text-[10px] text-muted-foreground">{formattedTime}</span>
                        <span className={`rounded-xs border px-1.5 py-0.5 text-[9px] font-bold uppercase ${actorTag}`}>
                          {item.actor}
                        </span>
                        <span className="rounded-xs border border-border px-1.5 py-0.5 text-[9px] text-muted-foreground">
                          {item.badge}
                        </span>
                        {item.verdict && <VerdictChip verdict={item.verdict} />}
                      </div>

                      {hasDetails && (
                        <button
                          onClick={() => togglePayload(item.id)}
                          className="font-mono text-[10px] text-primary hover:underline"
                        >
                          {isExpanded ? "hide [x]" : "payload →"}
                        </button>
                      )}
                    </div>

                    <div className="px-2.5 pb-2.5 font-mono text-[11px] text-foreground leading-relaxed">
                      {item.summary}
                    </div>

                    {/* Expandable JSON Detail */}
                    {isExpanded && hasDetails && (
                      <div className="border-t border-border/60 bg-muted/40 p-2.5 font-mono text-[10px]">
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
        </div>

        {/* ================================================================== */}
        {/* PANE 3: SELLER AGENT                                               */}
        {/* ================================================================== */}
        <div className="rounded-sm border border-border bg-card p-5 space-y-5">
          <div className="border-b border-border/80 pb-3">
            <div className="flex items-center justify-between">
              <div className="font-mono text-sm font-bold uppercase tracking-wider text-sky-400">
                SELLER AGENT
              </div>
              <span className="rounded-xs border border-sky-500/30 bg-sky-500/10 px-1.5 py-0.5 font-mono text-[10px] uppercase text-sky-400">
                Merchant Authority
              </span>
            </div>
            <p className="mt-1 font-mono text-[11px] text-muted-foreground">
              Kalakriti Gift Co. merchandising agent &amp; discount authority.
            </p>
          </div>

          {/* Merchandising & Upsell Engine */}
          <div>
            <SectionLabel>cross-sell rule engine</SectionLabel>
            <div className="rounded-xs border border-border bg-background p-3 font-mono text-[11px] space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-muted-foreground">Rule Trigger:</span>
                <span className="text-foreground">
                  {sellerCounterPayload.add_sku ? "Cart SKU match" : "Default List Price"}
                </span>
              </div>
              {sellerCounterPayload.add_sku && (
                <div className="flex items-center justify-between">
                  <span className="text-muted-foreground">Suggested SKU:</span>
                  <span className="font-semibold text-primary">{sellerCounterPayload.add_sku}</span>
                </div>
              )}
              <div className="flex items-center justify-between">
                <span className="text-muted-foreground">Discount Authority:</span>
                <span className="text-allow font-semibold">
                  {sellerCounterPayload.discount_bps
                    ? `${sellerCounterPayload.discount_bps / 100}% max cap`
                    : "No discount"}
                </span>
              </div>
            </div>
          </div>

          {/* Seller Pitch & Counter Offer */}
          <div>
            <SectionLabel>seller counter-offer pitch</SectionLabel>
            {sellerCounter ? (
              <div className="rounded-xs border border-border bg-background p-3 font-mono text-[11px] leading-relaxed text-foreground">
                <div className="text-[10px] text-sky-400 font-semibold uppercase mb-1">
                  AI Merchandising Pitch:
                </div>
                {sellerCounter.body}
              </div>
            ) : (
              <div className="rounded-xs border border-border bg-background p-3 font-mono text-[11px] text-muted-foreground">
                {isPending ? "Seller agent evaluating upsell rules…" : "No counter offer generated."}
              </div>
            )}
          </div>

          {/* Razorpay Test Settlement Panel */}
          <div>
            <SectionLabel>razorpay test settlement</SectionLabel>
            <div className="rounded-xs border border-border bg-background p-3 font-mono text-[11px] space-y-2.5">
              <div className="flex items-center justify-between">
                <span className="text-muted-foreground">Razorpay Order:</span>
                <span className="font-semibold text-foreground">
                  {primaryOrder?.razorpay_order_id ?? "—"}
                </span>
              </div>

              <div className="flex items-center justify-between">
                <span className="text-muted-foreground">Charge Amount:</span>
                <span className="font-semibold text-primary">
                  {formatINR(orderAmountPaise)}
                </span>
              </div>

              <div className="flex items-center justify-between">
                <span className="text-muted-foreground">Payment Status:</span>
                <StatusChip status={primaryOrder?.status ?? "none"} />
              </div>

              {primaryOrder?.razorpay_link_url && (
                <div className="pt-2 border-t border-border">
                  <a
                    href={primaryOrder.razorpay_link_url}
                    target="_blank"
                    rel="noreferrer"
                    className="block w-full text-center rounded-xs bg-primary px-3 py-2 font-mono text-xs font-semibold text-primary-foreground transition-opacity hover:opacity-90"
                  >
                    Pay via Razorpay →
                  </a>
                  <span className="mt-1 block text-center text-[10px] text-muted-foreground">
                    Test Mode Payment Link
                  </span>
                </div>
              )}

              {isFailed && (
                <div className="rounded-xs border border-deny/40 bg-deny/10 p-2 text-[10px] text-deny leading-snug">
                  Charge deliberately rejected by gateway (Gateway Failure Mode). No blind retry was attempted.
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function GuardrailRow({
  name,
  rule,
  verdict,
  reason,
}: {
  name: string;
  rule: string;
  verdict: "allow" | "deny" | "escalate";
  reason: string;
}) {
  return (
    <div className="rounded-xs border border-border bg-background p-2.5">
      <div className="flex items-center justify-between">
        <span className="font-semibold text-foreground uppercase text-[10px]">{name}</span>
        <VerdictChip verdict={verdict} />
      </div>
      <div className="text-[10px] text-muted-foreground mt-0.5">{rule}</div>
      <div className="text-[10px] text-muted-foreground/80 mt-1">{reason}</div>
    </div>
  );
}

