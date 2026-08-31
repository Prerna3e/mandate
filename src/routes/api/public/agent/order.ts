import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";

// Simple in-memory rate limiter per API key.
// Note: This counter resets on server restart and is not synchronized across multiple server instances,
// but provides basic flood protection for single-instance deployments.
const RATE_LIMIT_WINDOW_MS = 60 * 1000;
const MAX_REQUESTS_PER_WINDOW = 10;
const rateLimitMap = new Map<string, { count: number; resetAt: number }>();

function checkRateLimit(apiKey: string): { allowed: boolean; retryAfter?: number } {
  const now = Date.now();
  const entry = rateLimitMap.get(apiKey);
  if (!entry || now > entry.resetAt) {
    rateLimitMap.set(apiKey, { count: 1, resetAt: now + RATE_LIMIT_WINDOW_MS });
    return { allowed: true };
  }
  if (entry.count >= MAX_REQUESTS_PER_WINDOW) {
    const retryAfter = Math.ceil((entry.resetAt - now) / 1000);
    return { allowed: false, retryAfter };
  }
  entry.count += 1;
  return { allowed: true };
}

const OrderIntent = z.object({
  items: z.array(z.object({ sku: z.string().max(64), qty: z.number().int().min(1).max(5) })).min(1).max(10),
  budget_minor: z.number().int().positive().optional(),
});

export const Route = createFileRoute("/api/public/agent/order")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        // 1. Authentication
        const apiKeyHeader = request.headers.get("x-agent-api-key");
        const expectedApiKey = process.env["EXTERNAL_AGENT_API_KEY"];

        if (!expectedApiKey || !apiKeyHeader || apiKeyHeader !== expectedApiKey) {
          return Response.json(
            {
              error: "unauthorized",
              message: "Missing or invalid 'x-agent-api-key' header.",
            },
            { status: 401 },
          );
        }

        // 2. Rate Limiting
        const rateCheck = checkRateLimit(apiKeyHeader);
        if (!rateCheck.allowed) {
          return Response.json(
            {
              error: "rate_limit_exceeded",
              message: "Rate limit exceeded (max 10 requests per minute).",
            },
            {
              status: 429,
              headers: {
                "Retry-After": String(rateCheck.retryAfter ?? 60),
              },
            },
          );
        }

        // 3. Idempotency Header Check
        const idempotencyKey =
          request.headers.get("Idempotency-Key") || request.headers.get("idempotency-key");
        if (!idempotencyKey || idempotencyKey.trim() === "") {
          return Response.json(
            {
              error: "missing_idempotency_key",
              message: "The 'Idempotency-Key' header is required.",
            },
            { status: 400 },
          );
        }

        // 4. Request Body Validation
        let body: unknown;
        try {
          body = await request.json();
        } catch {
          return Response.json({ error: "invalid_json", message: "Request body must be valid JSON." }, { status: 400 });
        }

        const parsed = OrderIntent.safeParse(body);
        if (!parsed.success) {
          return Response.json(
            {
              error: "invalid_intent",
              message: "Invalid order intent payload.",
              details: parsed.error.flatten(),
            },
            { status: 400 },
          );
        }

        // 5. Policy-gated execution and order creation
        const { createOrderForExternalAgent } = await import("@/lib/agent-run.server");
        const result = await createOrderForExternalAgent({
          items: parsed.data.items,
          budgetPaise: parsed.data.budget_minor,
          idempotencyKey: idempotencyKey.trim(),
        });

        return Response.json(result.body, { status: result.status });
      },
    },
  },
});
