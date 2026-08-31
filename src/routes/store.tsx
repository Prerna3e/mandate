import { createFileRoute } from "@tanstack/react-router";
import { queryOptions, useSuspenseQuery } from "@tanstack/react-query";

import { ConsoleShell, SectionLabel } from "@/components/console-chrome";
import { listCatalog } from "@/lib/public-data.functions";
import { formatINR } from "@/lib/money";

const catalogQuery = queryOptions({
  queryKey: ["catalog"],
  queryFn: () => listCatalog(),
});

export const Route = createFileRoute("/store")({
  head: () => ({
    meta: [
      { title: "Storefront — Kalakriti Gift Co. agentic catalog" },
      {
        name: "description",
        content:
          "The human view of the same catalog that AI buyer agents read as JSON: handcrafted gifting SKUs with live prices and stock.",
      },
      { property: "og:title", content: "Storefront — Kalakriti Gift Co. agentic catalog" },
      {
        property: "og:description",
        content: "The same merchant catalog, served to humans as a storefront and to agents as JSON.",
      },
    ],
  }),
  loader: ({ context }) => context.queryClient.ensureQueryData(catalogQuery),
  component: StorePage,
  errorComponent: () => (
    <ConsoleShell>
      <div className="mx-auto max-w-3xl px-5 py-24 text-sm text-muted-foreground">
        The catalog could not be loaded right now.
      </div>
    </ConsoleShell>
  ),
});

function StorePage() {
  const { data: products } = useSuspenseQuery(catalogQuery);

  return (
    <ConsoleShell>
      <main className="mx-auto max-w-7xl px-5 py-12">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <h1 className="text-3xl font-bold text-foreground">Kalakriti Gift Co.</h1>
            <p className="mt-2 max-w-xl text-sm text-muted-foreground">
              Handcrafted corporate gifting from India. Humans see this page; agents see the identical inventory as
              structured JSON.
            </p>
          </div>
          <a
            href="/api/public/agent/catalog"
            className="rounded-sm border border-border bg-card px-3 py-2 font-mono text-[12px] text-primary transition-colors hover:bg-accent"
          >
            view as agent JSON →
          </a>
        </div>

        <div className="mt-10">
          <SectionLabel>{products.length} skus · inr</SectionLabel>
          <div className="grid gap-px overflow-hidden rounded-sm border border-border bg-border sm:grid-cols-2 lg:grid-cols-3">
            {products.map((p) => (
              <article key={p.sku} className="flex flex-col bg-card p-5">
                <div className="flex items-center justify-between">
                  <span className="font-mono text-[11px] text-muted-foreground">{p.sku}</span>
                  <span
                    className={
                      p.stock > 0
                        ? "font-mono text-[11px] text-allow"
                        : "font-mono text-[11px] text-deny"
                    }
                  >
                    {p.stock > 0 ? `${p.stock} in stock` : "out of stock"}
                  </span>
                </div>
                <h2 className="mt-3 text-base font-semibold text-foreground">{p.title}</h2>
                <p className="mt-2 flex-1 text-sm leading-relaxed text-muted-foreground">{p.description}</p>
                <div className="mt-4 flex flex-wrap gap-1.5">
                  {(p.tags ?? []).map((t) => (
                    <span
                      key={t}
                      className="rounded-sm border border-border px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground"
                    >
                      {t}
                    </span>
                  ))}
                </div>
                <div className="mt-5 flex items-baseline justify-between border-t border-border pt-4">
                  <span className="font-mono text-lg font-semibold text-primary">{formatINR(p.price_paise)}</span>
                  <span className="font-mono text-[11px] text-muted-foreground">{p.price_paise} paise</span>
                </div>
              </article>
            ))}
          </div>
        </div>
      </main>
    </ConsoleShell>
  );
}
