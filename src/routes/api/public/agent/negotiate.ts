import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";

const Intent = z.object({
  items: z.array(z.object({ sku: z.string().max(64), qty: z.number().int().min(1).max(5) })).min(1).max(10),
  budget_minor: z.number().int().positive().optional(),
});

export const Route = createFileRoute("/api/public/agent/negotiate")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        let body: unknown;
        try {
          body = await request.json();
        } catch {
          return Response.json({ error: "invalid_json" }, { status: 400 });
        }

        const parsed = Intent.safeParse(body);
        if (!parsed.success) {
          return Response.json({ error: "invalid_intent", details: parsed.error.flatten() }, { status: 400 });
        }

        const { negotiateForExternalAgent } = await import("@/lib/agent-run.server");
        const result = await negotiateForExternalAgent({
          items: parsed.data.items,
          budgetPaise: parsed.data.budget_minor,
        });

        return Response.json(result, { status: result.accepted ? 200 : 422 });
      },
    },
  },
});
