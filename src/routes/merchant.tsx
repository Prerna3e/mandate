import { createFileRoute, Link } from "@tanstack/react-router";
import { queryOptions, useSuspenseQuery } from "@tanstack/react-query";

import { ConsoleShell, SectionLabel, StatusChip } from "@/components/console-chrome";
import { listMerchantConsole } from "@/lib/public-data.functions";
import { formatINR } from "@/lib/money";

const consoleQuery = queryOptions({
  queryKey: ["merchant-console"],
  queryFn: () => listMerchantConsole(),
});

export const Route = createFileRoute("/merchant")({
  head: () => ({
    meta: [
      { title: "Merchant console — policy caps, upsell rules and agent orders" },
      {
        name: "description",
        content:
          "The merchant's side of agentic commerce: spend caps, category allowlists, discount authority, cross-sell rules and every order an agent has created.",
      },
      { property: "og:title", content: "Merchant console — policy caps and agent orders" },
      {
        property: "og:description",
        content: "Spend caps, discount authority, cross-sell rules and the agent order log.",
      },
    ],
  }),
  loader: ({ context }) => context.queryClient.ensureQueryData(consoleQuery),
  component: MerchantPage,
  errorComponent: () => (
    <ConsoleShell>
      <div className="mx-auto max-w-3xl px-5 py-24 text-sm text-muted-foreground">
        The merchant console could not be loaded right now.
      </div>
    </ConsoleShell>
  ),
});

function MerchantPage() {
  const { data } = useSuspenseQuery(consoleQuery);

  return (
    <ConsoleShell>
      <main className="mx-auto max-w-7xl px-5 py-12">
        <h1 className="text-3xl font-bold text-foreground">Merchant console</h1>
        <p className="mt-2 max-w-2xl text-sm text-muted-foreground">
          These rows are the only thing standing between an autonomous agent and the merchant's money. Both agents read
          them before every action.
        </p>

        <section className="mt-10">
          <SectionLabel>policy caps</SectionLabel>
          <div className="grid gap-px overflow-hidden rounded-sm border border-border bg-border md:grid-cols-2">
            {data.caps.map((c) => (
              <div key={c.id} className="bg-card p-5">
                <div className="flex items-center justify-between">
                  <span className="font-mono text-[12px] font-semibold uppercase tracking-wider text-primary">
                    {c.scope} agent
                  </span>
                  <span className="font-mono text-[11px] text-muted-foreground">auto-approve within caps</span>
                </div>
                <dl className="mt-4 space-y-2 font-mono text-[12px]">
                  <Row label="max order total" value={formatINR(c.max_order_paise)} />
                  <Row label="max single item" value={formatINR(c.max_item_paise)} />
                  <Row label="max discount" value={`${c.max_discount_bps / 100}%`} />
                  <Row label="max retries" value={String(c.max_retries)} />
                </dl>
                <div className="mt-4 flex flex-wrap gap-1.5">
                  {(c.allowed_categories ?? []).map((cat: string) => (
                    <span
                      key={cat}
                      className="rounded-sm border border-allow/40 bg-allow/10 px-1.5 py-0.5 font-mono text-[10px] text-allow"
                    >
                      {cat}
                    </span>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </section>

        <section className="mt-10">
          <SectionLabel>cross-sell rules · seller agent</SectionLabel>
          <div className="overflow-hidden rounded-sm border border-border">
            <table className="w-full border-collapse text-left font-mono text-[12px]">
              <thead className="bg-muted text-muted-foreground">
                <tr>
                  <Th>trigger</Th>
                  <Th>suggests</Th>
                  <Th>max discount</Th>
                  <Th>rationale</Th>
                  <Th>state</Th>
                </tr>
              </thead>
              <tbody>
                {data.rules.map((r) => (
                  <tr key={r.id} className="border-t border-border bg-card">
                    <Td>{r.trigger_sku ?? r.trigger_category ?? "—"}</Td>
                    <Td className="text-primary">{r.suggested_sku}</Td>
                    <Td>{r.max_discount_bps / 100}%</Td>
                    <Td className="max-w-sm text-muted-foreground">{r.rationale}</Td>
                    <Td>
                      <StatusChip status={r.active ? "active" : "paused"} />
                    </Td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>

        <section className="mt-10">
          <SectionLabel>agent orders</SectionLabel>
          {data.orders.length === 0 ? (
            <div className="rounded-sm border border-border bg-card p-8 text-center text-sm text-muted-foreground">
              No agent has transacted yet.{" "}
              <Link to="/agent" className="text-primary underline-offset-4 hover:underline">
                Run a negotiation
              </Link>
              .
            </div>
          ) : (
            <div className="overflow-x-auto rounded-sm border border-border">
              <table className="w-full border-collapse text-left font-mono text-[12px]">
                <thead className="bg-muted text-muted-foreground">
                  <tr>
                    <Th>created</Th>
                    <Th>subtotal</Th>
                    <Th>discount</Th>
                    <Th>charged</Th>
                    <Th>status</Th>
                    <Th>razorpay</Th>
                    <Th>audit</Th>
                  </tr>
                </thead>
                <tbody>
                  {data.orders.map((o) => (
                    <tr key={o.id} className="border-t border-border bg-card">
                      <Td>{new Date(o.created_at).toLocaleString("en-IN")}</Td>
                      <Td>{formatINR(o.subtotal_paise)}</Td>
                      <Td className={o.discount_paise > 0 ? "text-allow" : "text-muted-foreground"}>
                        −{formatINR(o.discount_paise)}
                      </Td>
                      <Td className="font-semibold text-foreground">{formatINR(o.amount_paise)}</Td>
                      <Td>
                        <StatusChip status={o.status} />
                      </Td>
                      <Td className="text-muted-foreground">{o.razorpay_order_id ?? "—"}</Td>
                      <Td>
                        {o.session_id ? (
                          <Link
                            to="/audit/$sessionId"
                            params={{ sessionId: o.session_id }}
                            className="text-primary underline-offset-4 hover:underline"
                          >
                            trail →
                          </Link>
                        ) : (
                          "—"
                        )}
                      </Td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      </main>
    </ConsoleShell>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between border-b border-border pb-1.5">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="text-foreground">{value}</dd>
    </div>
  );
}

function Th({ children }: { children: React.ReactNode }) {
  return <th className="px-3 py-2 font-medium uppercase tracking-wider">{children}</th>;
}

function Td({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return <td className={`px-3 py-2.5 align-top ${className}`}>{children}</td>;
}
