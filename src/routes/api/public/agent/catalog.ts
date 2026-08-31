import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/api/public/agent/catalog")({
  server: {
    handlers: {
      GET: async () => {
        const { fetchCatalog } = await import("@/lib/public-data.server");
        const products = await fetchCatalog();
        return Response.json(
          {
            "@context": "https://schema.org",
            version: "2026-01",
            merchant: { name: "Kalakriti Gift Co.", country: "IN", currency: "INR" },
            updated_at: new Date().toISOString(),
            items: products.map((p) => ({
              sku: p.sku,
              name: p.title,
              description: p.description,
              category: p.category,
              tags: p.tags,
              price: { amount_minor: p.price_paise, currency: "INR" },
              availability: p.stock > 0 ? "in_stock" : "out_of_stock",
              stock: p.stock,
            })),
          },
          { headers: { "Cache-Control": "public, max-age=30" } },
        );
      },
    },
  },
});
