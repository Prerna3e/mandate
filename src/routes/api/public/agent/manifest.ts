import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/api/public/agent/manifest")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const origin = new URL(request.url).origin;
        return Response.json({
          spec_version: "agentic-commerce/0.1",
          merchant: {
            name: "Kalakriti Gift Co.",
            country: "IN",
            currency: "INR",
            mode: "test",
            payment_processor: "razorpay",
          },
          discovery: {
            catalog: `${origin}/api/public/agent/catalog`,
            manifest: `${origin}/api/public/agent/manifest`,
          },
          capabilities: [
            {
              name: "search_catalog",
              method: "GET",
              endpoint: "/api/public/agent/catalog",
              cost: "free",
              requires_approval: false,
            },
            {
              name: "negotiate",
              method: "POST",
              endpoint: "/api/public/agent/negotiate",
              description: "Submit a structured buyer intent and receive a binding quote plus a bounded counter-offer.",
              cost: "free",
              requires_approval: false,
            },
            {
              name: "create_payment_order",
              method: "POST",
              endpoint: "/api/public/agent/order",
              description: "Money action. Gated by the seller policy engine and always audited.",
              note: "Requires 'x-agent-api-key' for authentication and 'Idempotency-Key' headers.",
              cost: "quoted_total",
              requires_approval: true,
            },
          ],
          payment: {
            processor: "razorpay",
            environment: "test",
            methods: ["upi", "card", "netbanking"],
            settlement_currency: "INR",
            webhook: `${origin}/api/public/razorpay/webhook`,
          },
          policy: {
            discount_authority_bps: 2000,
            max_order_total_minor: 1000000,
            every_money_action_audited: true,
            audit_export: `${origin}/audit/{session_id}`,
          },
        });
      },
    },
  },
});
