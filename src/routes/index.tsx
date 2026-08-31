import { createFileRoute, Link } from "@tanstack/react-router";

import { ConsoleShell, SectionLabel } from "@/components/console-chrome";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Agentic Commerce Console — two agents, one audited checkout" },
      {
        name: "description",
        content:
          "A buyer agent and a seller agent negotiate a real Razorpay test-mode order over an agent-readable catalog, with every money action bounded by policy and logged.",
      },
      { property: "og:title", content: "Agentic Commerce Console — two agents, one audited checkout" },
      {
        property: "og:description",
        content: "Policy-gated agent-to-agent commerce on Razorpay test mode, with a full audit trail.",
      },
    ],
  }),
  component: Index,
});

const PILLARS = [
  {
    k: "01",
    title: "Agent-readable merchant",
    body: "A capability manifest and a machine catalog let any external buyer agent discover SKUs, prices, stock and the exact money actions it may take.",
    links: [
      { label: "/api/public/agent/manifest", href: "/api/public/agent/manifest" },
      { label: "/api/public/agent/catalog", href: "/api/public/agent/catalog" },
    ],
  },
  {
    k: "02",
    title: "Bounded money actions",
    body: "Every charge passes a policy engine first: per-order cap, per-item cap, category allowlist, mandate budget, and the seller's own discount authority.",
    links: [],
  },
  {
    k: "03",
    title: "Explainable audit trail",
    body: "Each agent turn, policy verdict and Razorpay call lands on a sequenced ledger you can replay line by line — including the failure path.",
    links: [],
  },
];

function Index() {
  return (
    <ConsoleShell>
      <main>
        <section className="relative overflow-hidden border-b border-border">
          <div className="pointer-events-none absolute inset-0 grid-lines opacity-40" />
          <div className="relative mx-auto max-w-7xl px-5 py-20">
            <div className="inline-flex items-center gap-2 rounded-sm border border-border bg-card px-2.5 py-1 font-mono text-[11px] text-muted-foreground">
              track 01 · ai growth &amp; agentic commerce
            </div>
            <h1 className="mt-6 max-w-3xl text-4xl font-bold leading-[1.08] text-foreground sm:text-6xl">
              Two agents. One merchant.
              <br />
              <span className="text-primary">Every rupee accounted for.</span>
            </h1>
            <p className="mt-6 max-w-2xl text-base leading-relaxed text-muted-foreground">
              A buyer agent holding a spend mandate discovers a merchant's machine-readable catalog, negotiates with the
              merchant's seller agent, clears a policy gate, and settles a real Razorpay test-mode order. Nothing is
              charged that the policy engine did not explicitly allow.
            </p>
            <div className="mt-9 flex flex-wrap gap-3">
              <Link
                to="/agent"
                className="rounded-sm bg-primary px-4 py-2.5 font-mono text-[13px] font-semibold text-primary-foreground transition-opacity hover:opacity-90"
              >
                Run the negotiation →
              </Link>
              <Link
                to="/store"
                className="rounded-sm border border-border bg-card px-4 py-2.5 font-mono text-[13px] text-foreground transition-colors hover:bg-accent"
              >
                Browse the storefront
              </Link>
            </div>
          </div>
        </section>

        <section className="mx-auto max-w-7xl px-5 py-16">
          <SectionLabel>the bar</SectionLabel>
          <div className="grid gap-px overflow-hidden rounded-sm border border-border bg-border md:grid-cols-3">
            {PILLARS.map((p) => (
              <div key={p.k} className="bg-card p-6">
                <div className="font-mono text-[11px] text-primary">{p.k}</div>
                <h2 className="mt-3 text-lg font-semibold text-foreground">{p.title}</h2>
                <p className="mt-2 text-sm leading-relaxed text-muted-foreground">{p.body}</p>
                {p.links.length > 0 && (
                  <div className="mt-4 space-y-1.5">
                    {p.links.map((l) => (
                      <a
                        key={l.href}
                        href={l.href}
                        className="block font-mono text-[11px] text-primary underline-offset-4 hover:underline"
                      >
                        {l.label}
                      </a>
                    ))}
                  </div>
                )}
              </div>
            ))}
          </div>
        </section>

        <section className="mx-auto max-w-7xl px-5 pb-8">
          <SectionLabel>the flow</SectionLabel>
          <div className="overflow-x-auto rounded-sm border border-border bg-card p-6">
            <pre className="font-mono text-[12px] leading-6 text-muted-foreground">{`buyer agent            policy gate            seller agent           razorpay (test)
    │                       │                       │                       │
    ├─ read manifest ───────┼──────────────────────►│                       │
    ├─ plan cart ──────────►│  caps + mandate       │                       │
    │                       ├─ allow / deny / escalate                      │
    │◄── counter-offer ─────┼───────────────────────┤ upsell within          │
    │                       │                       │ discount authority     │
    ├─ authorize charge ───►│  bounded amount ─────────────────────────────► order + link
    │                       │                       │                       │
    └─ audit trail ◄────────┴───────────────────────┴───────────────────────┘`}</pre>
          </div>
        </section>
      </main>
    </ConsoleShell>
  );
}
