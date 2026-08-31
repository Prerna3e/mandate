import { generateText, isStepCount, tool } from "ai";
import { z } from "zod";

import { createAgentAiProvider } from "./ai-gateway.server";
import {
  cartSubtotal,
  evaluateBuyerCart,
  evaluateSellerDiscount,
  trimCartToBudget,
  worstVerdict,
  type CartLine,
  type Caps,
  type PolicyDecision,
} from "./policy";
import { razorpayCreateOrder, razorpayCreatePaymentLink, RazorpayError } from "./razorpay.server";

export type RunMode = "happy" | "overcap" | "payment_failure";

interface ProductRow {
  sku: string;
  title: string;
  description: string;
  price_paise: number;
  stock: number;
  category: string;
  tags: string[];
}

interface UpsellRow {
  trigger_category: string | null;
  trigger_sku: string | null;
  suggested_sku: string;
  rationale: string;
  max_discount_bps: number;
  active: boolean;
}

type Admin = Awaited<typeof import("@/integrations/supabase/client.server")>["supabaseAdmin"];

/** Supabase's generated Json type is structural; our payloads are plain JSON-safe objects. */
function asJson(value: unknown) {
  return value as never;
}

/* ------------------------------------------------------------------ */
/* Audited action layer                                                */
/* ------------------------------------------------------------------ */

class Ledger {
  constructor(
    private admin: Admin,
    private sessionId: string,
  ) {}

  async event(actor: string, eventType: string, summary: string, detail: Record<string, unknown> = {}) {
    const now = new Date().toISOString();
    const { memoryStore } = await import("./session-store");
    const mem = memoryStore.get(this.sessionId);
    if (mem) {
      mem.events.push({
        id: crypto.randomUUID(),
        session_id: this.sessionId,
        seq: mem.events.length + 1,
        actor,
        event_type: eventType,
        summary,
        detail,
        created_at: now,
      });
    }

    try {
      await this.admin.from("audit_events").insert({
        session_id: this.sessionId,
        actor,
        event_type: eventType,
        summary,
        detail: asJson(detail),
      });
    } catch {
      // Resilient fallback when remote DB RLS prevents write
    }
  }

  async message(sender: string, kind: string, turn: number, body: string, payload: Record<string, unknown> = {}) {
    const now = new Date().toISOString();
    const { memoryStore } = await import("./session-store");
    const mem = memoryStore.get(this.sessionId);
    if (mem) {
      mem.messages.push({
        id: crypto.randomUUID(),
        session_id: this.sessionId,
        turn,
        sender,
        kind,
        body,
        payload,
        created_at: now,
      });
    }

    try {
      await this.admin.from("agent_messages").insert({
        session_id: this.sessionId,
        sender,
        kind,
        turn,
        body,
        payload: asJson(payload),
      });
    } catch {
      // Resilient fallback
    }
    await this.event(sender, `message.${kind}`, body.slice(0, 240), payload);
  }

  async decisions(actor: string, action: string, list: PolicyDecision[]) {
    if (list.length === 0) return;
    const now = new Date().toISOString();
    const { memoryStore } = await import("./session-store");
    const mem = memoryStore.get(this.sessionId);
    if (mem) {
      for (const d of list) {
        mem.decisions.push({
          id: crypto.randomUUID(),
          session_id: this.sessionId,
          actor,
          action,
          rule_name: d.rule_name,
          inputs: d.inputs,
          verdict: d.verdict,
          reason: d.reason,
          created_at: now,
        });
      }
    }

    try {
      await this.admin.from("policy_decisions").insert(
        list.map((d) => ({
          session_id: this.sessionId,
          actor,
          action,
          rule_name: d.rule_name,
          inputs: asJson(d.inputs),
          verdict: d.verdict,
          reason: d.reason,
        })),
      );
    } catch {
      // Resilient fallback
    }
    for (const d of list) {
      await this.event(actor, `policy.${d.verdict}`, `${d.rule_name}: ${d.reason}`, {
        action,
        ...d.inputs,
      });
    }
  }
}

/* ------------------------------------------------------------------ */
/* Buyer agent: pick a cart                                            */
/* ------------------------------------------------------------------ */

const CartPlan = z.object({
  rationale: z.string(),
  lines: z.array(z.object({ sku: z.string(), qty: z.number() })),
});

function deterministicCart(products: ProductRow[], budgetPaise: number): { skus: { sku: string; qty: number }[] } {
  const sorted = [...products].filter((p) => p.stock > 0).sort((a, b) => b.price_paise - a.price_paise);
  const picked: { sku: string; qty: number }[] = [];
  let spend = 0;
  for (const p of sorted) {
    if (spend + p.price_paise <= budgetPaise * 0.85) {
      picked.push({ sku: p.sku, qty: 1 });
      spend += p.price_paise;
    }
    if (picked.length >= 3) break;
  }
  if (picked.length === 0 && sorted.length > 0) picked.push({ sku: sorted[sorted.length - 1]!.sku, qty: 1 });
  return { skus: picked };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Accept predictable model aliases while validating the final plan strictly. */
function normalizeCartPlan(value: unknown): z.infer<typeof CartPlan> {
  const candidate = Array.isArray(value) ? { lines: value, rationale: "AI-selected cart." } : value;
  if (!isRecord(candidate)) {
    throw new Error("Expected a JSON object with rationale and lines.");
  }

  const rawLines = candidate["lines"] ?? candidate["Lines"] ?? candidate["items"] ?? candidate["Items"];
  if (!Array.isArray(rawLines)) {
    throw new Error("Expected a lines array in the AI JSON response.");
  }

  return CartPlan.parse({
    rationale: candidate["rationale"] ?? candidate["Rationale"] ?? "AI-selected cart.",
    lines: rawLines.map((line) => {
      if (!isRecord(line)) return line;
      return {
        sku: line["sku"] ?? line["SKU"] ?? line["Sku"],
        qty: Number(line["qty"] ?? line["Quantity"] ?? line["quantity"] ?? line["Qty"]),
      };
    }),
  });
}

function logAiCallError(call: "planCart" | "sellerPitch", error: unknown) {
  if (error instanceof Error) {
    console.error(`[${call}] AI call failed with full error details:`, {
      name: error.name,
      message: error.message,
      stack: error.stack,
      cause: error.cause,
    });
    // SDK errors may contain non-enumerable HTTP metadata, so log the original too.
    console.error(`[${call}] Original caught error object:`, error);
    return;
  }

  console.error(`[${call}] AI call failed with a non-Error value:`, error);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Executes an AI SDK call with exponential backoff delays (e.g. 2s, 5s)
 * preventing rapid-fire bursts from tripping per-minute rate limits.
 */
async function callWithBackoff<T>(
  actionName: string,
  fn: (attempt: number) => Promise<T>,
  maxAttempts: number = 3,
  delaysMs: number[] = [2000, 5000, 10000],
): Promise<T> {
  let lastError: unknown;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await fn(attempt);
    } catch (error) {
      lastError = error;
      if (attempt < maxAttempts) {
        const delay = delaysMs[attempt - 1] ?? 5000;
        console.warn(
          `[${actionName}] Attempt ${attempt}/${maxAttempts} failed (${error instanceof Error ? error.message : String(error)}). Backing off for ${delay}ms before next attempt...`,
        );
        await sleep(delay);
      } else {
        console.error(`[${actionName}] All ${maxAttempts} attempts exhausted.`);
      }
    }
  }
  throw lastError;
}

async function planCart(args: {
  brief: string;
  budgetPaise: number;
  products: ProductRow[];
}): Promise<{ rationale: string; lines: { sku: string; qty: number }[]; source: "model" | "fallback" }> {
  const { brief, budgetPaise, products } = args;
  const fallback = (rationaleOverride?: string) => ({
    rationale: "No AI API key configured (set GEMINI_API_KEY or LOVABLE_API_KEY in environment) — used deterministic cart planner.",
    lines: deterministicCart(products, budgetPaise).skus,
    source: "fallback" as const,
    ...(rationaleOverride ? { rationale: rationaleOverride } : {}),
  });

  const ai = createAgentAiProvider();
  console.log("[planCart] createAgentAiProvider returned:", ai ? { modelName: ai.modelName, hasProvider: !!ai.provider } : null);

  if (!ai) {
    console.warn("[BuyerAgent] Neither GEMINI_API_KEY nor LOVABLE_API_KEY is configured. Falling back to deterministic planner.");
    const result = fallback();
    console.warn("[planCart] Returning fallback because createAgentAiProvider returned null:", result);
    return result;
  }

  const catalogText = products
    .map((p) => `${p.sku} | ${p.title} | ${p.category} | ${p.price_paise} paise | stock ${p.stock} | ${p.description}`)
    .join("\n");
  const requestPrompt = [
    "You are a BUYER AGENT shopping on behalf of a human principal.",
    `Shopping brief: ${brief}`,
    `Hard budget: ${budgetPaise} paise (₹${budgetPaise / 100}). Keep the subtotal comfortably under it.`,
    "",
    "Merchant catalog (agent-readable feed):",
    catalogText,
    "",
    "Pick between 1 and 3 SKUs that best satisfy the brief. Only use SKUs from the catalog.",
    "Keep qty small (1 or 2). Write a one or two sentence rationale explaining the choice to the human principal.",
    'Return ONLY valid JSON, with no markdown or extra text: {"rationale":"string","lines":[{"sku":"string","qty":number}]}.',
  ].join("\n");

  try {
    console.log(`[planCart] Starting generateText with exponential backoff using model '${ai.modelName}'...`);
    const response = await callWithBackoff(
      "planCart",
      async (attempt) => {
        console.log(`[planCart] Attempt ${attempt}: calling generateText...`);
        return await generateText({
          model: ai.provider(ai.modelName),
          maxRetries: 0, // Disable AI SDK internal rapid retries; backoff handled by wrapper
          prompt: requestPrompt,
        });
      },
      3,
      [2000, 5000, 10000],
    );

    const { text } = response;
    console.log("[planCart] generateText raw SDK response:", response.response);
    console.log("[planCart] generateText raw SDK request:", response.request);
    console.log("[planCart] generateText raw text:", text);

    let output: z.infer<typeof CartPlan>;
    try {
      output = normalizeCartPlan(JSON.parse(text));
      console.log("[planCart] Normalized and validated model cart plan:", output);
    } catch (formatError) {
      logAiCallError("planCart", formatError);
      const message = formatError instanceof Error ? formatError.message : String(formatError);
      const result = fallback(`AI response format invalid (${message}) - used deterministic cart planner.`);
      console.warn("[planCart] Returning fallback after invalid AI response format:", result);
      return result;
    }

    const valid = output.lines
      .filter((l) => products.some((p) => p.sku === l.sku))
      .map((l) => ({ sku: l.sku, qty: Math.max(1, Math.min(3, Math.round(l.qty || 1))) }));
    if (valid.length === 0) {
      console.warn("[planCart] Valid SKUs count is 0 after filtering output.lines:", output.lines);
      const result = fallback("AI response contained no known catalog SKUs - used deterministic cart planner.");
      console.warn("[planCart] Returning fallback because the model returned no catalog SKUs:", result);
      return result;
    }
    console.log("[planCart] Returning model generated cart plan:", { rationale: output.rationale, lines: valid });
    return { rationale: output.rationale, lines: valid, source: "model" };
  } catch (error) {
    logAiCallError("planCart", error);
    const result = {
      ...fallback(),
      rationale: `AI model call error (${error instanceof Error ? error.message : String(error)}) — fell back to deterministic cart planner.`,
    };
    console.warn("[planCart] Returning fallback after AI call error:", result);
    return result;
  }
}

/* ------------------------------------------------------------------ */
/* Seller agent tool definitions and tool-calling runner               */
/* ------------------------------------------------------------------ */

interface SellerAgentState {
  appliedDiscountBps: number;
  appliedDiscountPaise: number;
  addedSku: string | null;
  createdOrderId: string | null;
  createdPaymentLinkId: string | null;
}

export const SearchCatalogInputSchema = z.object({
  query: z.string().optional().describe("Search term or SKU to filter products"),
  category: z.string().optional().describe("Category filter (e.g., home, food, stationery, packaging)"),
});
export const SearchCatalogSchema = SearchCatalogInputSchema;

export const SearchCatalogOutputSchema = z.object({
  results: z.array(
    z.object({
      sku: z.string(),
      title: z.string(),
      category: z.string(),
      price_paise: z.number(),
      stock: z.number(),
      description: z.string(),
    }),
  ),
});

export const QuoteCartInputSchema = z.object({
  items: z
    .array(
      z.object({
        sku: z.string().describe("Catalog SKU"),
        qty: z.number().int().positive().default(1).describe("Quantity"),
      }),
    )
    .describe("Array of line items in the cart"),
});
export const QuoteCartSchema = QuoteCartInputSchema;

export const QuoteCartOutputSchema = z.object({
  lines: z.array(
    z.object({
      sku: z.string(),
      title: z.string(),
      qty: z.number(),
      unit_price_paise: z.number(),
      category: z.string(),
    }),
  ),
  subtotal_paise: z.number(),
  matched_upsell: z
    .object({
      trigger: z.string().nullable().optional(),
      suggested_sku: z.string(),
      suggested_title: z.string(),
      suggested_price_paise: z.number(),
      rationale: z.string(),
      max_discount_bps: z.number(),
    })
    .nullable(),
});

export const ApplyDiscountInputSchema = z.object({
  cart: z
    .array(
      z.object({
        sku: z.string().describe("SKU"),
        qty: z.number().int().positive().default(1).describe("Quantity"),
      }),
    )
    .describe("Cart line items including any proposed cross-sell SKU"),
  requested_discount_bps: z
    .number()
    .int()
    .min(0)
    .max(10000)
    .describe("Discount in basis points (e.g., 1000 = 10%, 2000 = 20%)"),
  rule_max_bps: z
    .number()
    .int()
    .min(0)
    .max(10000)
    .optional()
    .describe("Max discount allowed by the merchandising rule (defaults to seller policy cap if omitted)"),
  rationale: z.string().describe("Merchandising reason for applying this discount"),
});
export const ApplyDiscountSchema = ApplyDiscountInputSchema;

export const ApplyDiscountOutputSchema = z.object({
  allowed: z.boolean(),
  verdict: z.enum(["allow", "deny"]),
  reason: z.string(),
  effective_discount_bps: z.number(),
  discount_paise: z.number(),
  subtotal_paise: z.number(),
  final_total_paise: z.number(),
  rationale: z.string(),
  requested_discount_bps: z.number(),
  ceiling_discount_bps: z.number(),
  instruction: z.string(),
});

export const CreatePaymentOrderInputSchema = z.object({
  amount_paise: z.number().int().min(0).describe("Final amount to charge in paise"),
  receipt: z.string().describe("Order receipt / session identifier"),
  note: z.string().optional().describe("Optional metadata note for the payment gateway"),
});
export const CreatePaymentOrderSchema = CreatePaymentOrderInputSchema;

export const CreatePaymentOrderOutputSchema = z.object({
  allowed: z.boolean(),
  verdict: z.enum(["allow", "deny"]),
  reason: z.string(),
  success: z.boolean(),
  razorpay_order_id: z.string().nullable(),
  payment_link_url: z.string().nullable(),
  amount_paise: z.number(),
  status: z.string(),
  error: z.string().nullable(),
  http_status: z.number(),
});

export function createSellerTools(args: {
  ledger: Ledger;
  catalog: ProductRow[];
  upsells: UpsellRow[];
  sellerCaps: Caps;
  sessionId: string;
  buyerCart?: CartLine[];
  isPaymentFailureMode?: boolean;
  state?: SellerAgentState;
}) {
  const { ledger, catalog, upsells, sellerCaps, sessionId, isPaymentFailureMode, buyerCart } = args;
  const state: SellerAgentState = args.state ?? {
    appliedDiscountBps: 0,
    appliedDiscountPaise: 0,
    addedSku: null,
    createdOrderId: null,
    createdPaymentLinkId: null,
  };

  return {
    search_catalog: tool({
      description: "Search merchant catalog products by keyword, SKU, or category to find products, prices, and stock.",
      inputSchema: SearchCatalogInputSchema,
      outputSchema: SearchCatalogOutputSchema,
      execute: async ({ query, category }: z.infer<typeof SearchCatalogInputSchema>) => {
        let results = catalog;
        if (category) {
          results = results.filter((p) => p.category.toLowerCase() === category.toLowerCase());
        }
        if (query) {
          const q = query.toLowerCase();
          results = results.filter(
            (p) =>
              p.sku.toLowerCase().includes(q) ||
              p.title.toLowerCase().includes(q) ||
              p.description.toLowerCase().includes(q) ||
              p.tags.some((t) => t.toLowerCase().includes(q)),
          );
        }
        await ledger.event("seller", "tool.search_catalog", `Searched catalog: found ${results.length} products.`, {
          query: query ?? null,
          category: category ?? null,
          count: results.length,
        });
        return {
          results: results.map((p) => ({
            sku: p.sku,
            title: p.title,
            category: p.category,
            price_paise: p.price_paise,
            stock: p.stock,
            description: p.description,
          })),
        };
      },
    }),

    quote_cart: tool({
      description:
        "Quote line items, calculate subtotal, and inspect applicable cross-sell/upsell rules for a proposed cart.",
      inputSchema: QuoteCartInputSchema,
      outputSchema: QuoteCartOutputSchema,
      execute: async ({ items }: z.infer<typeof QuoteCartInputSchema>) => {
        const lines: CartLine[] = items.flatMap((i) => {
          const p = catalog.find((c) => c.sku === i.sku);
          if (!p) return [];
          return [
            {
              sku: p.sku,
              title: p.title,
              qty: i.qty,
              unit_price_paise: p.price_paise,
              category: p.category,
            },
          ];
        });

        const subtotal = cartSubtotal(lines);

        // Check active upsell rules matching the cart items or categories
        const matchedRule = upsells.find(
          (r) =>
            (r.trigger_sku && lines.some((l) => l.sku === r.trigger_sku)) ||
            (r.trigger_category && lines.some((l) => l.category === r.trigger_category)),
        );

        const suggestion = matchedRule ? catalog.find((p) => p.sku === matchedRule.suggested_sku) : undefined;
        const alreadyInCart = suggestion ? lines.some((l) => l.sku === suggestion.sku) : false;

        await ledger.event(
          "seller",
          "tool.quote_cart",
          `Quoted cart subtotal: ${subtotal} paise across ${lines.length} items.`,
          {
            lines_count: lines.length,
            subtotal_paise: subtotal,
            has_matched_upsell: Boolean(matchedRule && suggestion && !alreadyInCart),
          },
        );

        return {
          lines,
          subtotal_paise: subtotal,
          matched_upsell:
            matchedRule && suggestion && !alreadyInCart
              ? {
                  trigger: matchedRule.trigger_sku ?? matchedRule.trigger_category,
                  suggested_sku: suggestion.sku,
                  suggested_title: suggestion.title,
                  suggested_price_paise: suggestion.price_paise,
                  rationale: matchedRule.rationale,
                  max_discount_bps: matchedRule.max_discount_bps,
                }
              : null,
        };
      },
    }),

    apply_discount: tool({
      description:
        "Evaluate and apply a discount to the cart. Bounded by the seller agent's policy discount cap and merchandising authority.",
      inputSchema: ApplyDiscountInputSchema,
      outputSchema: ApplyDiscountOutputSchema,
      execute: async ({ cart, requested_discount_bps, rule_max_bps, rationale }: z.infer<typeof ApplyDiscountInputSchema>) => {
        const fullCart: CartLine[] = cart.flatMap((item: { sku: string; qty: number }) => {
          const p = catalog.find((c) => c.sku === item.sku);
          if (!p) return [];
          return [
            {
              sku: p.sku,
              title: p.title,
              qty: item.qty,
              unit_price_paise: p.price_paise,
              category: p.category,
            },
          ];
        });

        const subtotal = cartSubtotal(fullCart);
        const effectiveRuleMax = rule_max_bps ?? sellerCaps.max_discount_bps;

        // Policy pre-check against policy.ts engine
        const decision = evaluateSellerDiscount({
          discountBps: requested_discount_bps,
          ruleMaxBps: effectiveRuleMax,
          caps: sellerCaps,
        });

        await ledger.decisions("seller", "apply_discount", [decision]);

        if (decision.verdict !== "allow") {
          // Return structured refusal object to model (not throwing)
          const ceilingBps = Math.min(effectiveRuleMax, sellerCaps.max_discount_bps);
          return {
            allowed: false,
            verdict: "deny" as const,
            reason: decision.reason,
            effective_discount_bps: 0,
            discount_paise: 0,
            subtotal_paise: subtotal,
            final_total_paise: subtotal,
            rationale: decision.reason,
            requested_discount_bps,
            ceiling_discount_bps: ceilingBps,
            instruction: `Your requested discount of ${requested_discount_bps / 100}% was denied because it exceeds your authority. You may retry by applying up to ${ceilingBps / 100}% (${ceilingBps} bps).`,
          };
        }

        const effectiveBps = Math.min(requested_discount_bps, effectiveRuleMax, sellerCaps.max_discount_bps);
        const discountPaise = Math.round((subtotal * effectiveBps) / 10000);
        const finalTotalPaise = subtotal - discountPaise;

        state.appliedDiscountBps = effectiveBps;
        state.appliedDiscountPaise = discountPaise;

        if (buyerCart) {
          const addedItem = fullCart.find((c) => !buyerCart.some((bc) => bc.sku === c.sku));
          if (addedItem) {
            state.addedSku = addedItem.sku;
          }
        }

        return {
          allowed: true,
          verdict: "allow" as const,
          reason: decision.reason,
          effective_discount_bps: effectiveBps,
          discount_paise: discountPaise,
          subtotal_paise: subtotal,
          final_total_paise: finalTotalPaise,
          rationale,
          requested_discount_bps,
          ceiling_discount_bps: effectiveRuleMax,
          instruction: "Discount applied successfully within authorized limits.",
        };
      },
    }),

    create_payment_order: tool({
      description:
        "Create a Razorpay test-mode order and payment link for an authorized cart. Gated by seller caps and merchant authority.",
      inputSchema: CreatePaymentOrderInputSchema,
      outputSchema: CreatePaymentOrderOutputSchema,
      execute: async ({
        amount_paise,
        receipt,
        note,
      }: z.infer<typeof CreatePaymentOrderInputSchema>) => {
        // Pre-check against seller max order total cap
        if (amount_paise > sellerCaps.max_order_total_paise) {
          const decision: PolicyDecision = {
            rule_name: "seller.max_order_total",
            inputs: { amount_paise, max_order_total_paise: sellerCaps.max_order_total_paise },
            verdict: "deny",
            reason: `Charge of ${amount_paise} paise exceeds the seller max order cap of ${sellerCaps.max_order_total_paise} paise.`,
          };
          await ledger.decisions("seller", "create_payment_order", [decision]);
          return {
            allowed: false,
            verdict: "deny" as const,
            reason: decision.reason,
            success: false,
            razorpay_order_id: null,
            payment_link_url: null,
            amount_paise,
            status: "blocked",
            error: decision.reason,
            http_status: 403,
          };
        }

        const chargeAmount = isPaymentFailureMode ? 0 : amount_paise;
        try {
          const rzpOrder = await razorpayCreateOrder({
            amountPaise: chargeAmount,
            receipt: receipt.slice(0, 40),
            notes: { session_id: sessionId, agent: "seller-agent", ...(note ? { note } : {}) },
          });
          state.createdOrderId = rzpOrder.id;

          await ledger.event("seller", "razorpay.order_created", `Razorpay test order ${rzpOrder.id} created.`, {
            razorpay_order_id: rzpOrder.id,
            amount: rzpOrder.amount,
            status: rzpOrder.status,
          });

          let linkUrl: string | null = null;
          try {
            const link = await razorpayCreatePaymentLink({
              amountPaise: chargeAmount,
              description: `Agentic order ${receipt.slice(0, 8)}`,
              referenceId: receipt,
              notes: { session_id: sessionId, ...(note ? { note } : {}) },
            });
            linkUrl = link.short_url;
            state.createdPaymentLinkId = link.id;
            await ledger.event("seller", "razorpay.link_created", "Agent-payable checkout link issued.", {
              payment_link_id: link.id,
              short_url: link.short_url,
            });
          } catch (linkError) {
            const message = linkError instanceof RazorpayError ? linkError.message : String(linkError);
            await ledger.event("seller", "razorpay.link_failed", `Payment link could not be issued: ${message}`, {
              recoverable: true,
            });
          }

          return {
            allowed: true,
            verdict: "allow" as const,
            reason: "Razorpay order created successfully.",
            success: true,
            razorpay_order_id: rzpOrder.id,
            payment_link_url: linkUrl,
            amount_paise,
            status: rzpOrder.status,
            error: null,
            http_status: 200,
          };
        } catch (payError) {
          const message = payError instanceof RazorpayError ? payError.message : String(payError);
          const status = payError instanceof RazorpayError ? payError.status : 0;
          await ledger.event("seller", "razorpay.error", `Payment gateway rejected order creation: ${message}`, {
            http_status: status,
            retryable: false,
          });
          return {
            allowed: true,
            verdict: "allow" as const,
            reason: "Payment gateway error",
            success: false,
            razorpay_order_id: null,
            payment_link_url: null,
            amount_paise,
            status: "failed",
            error: message,
            http_status: status,
          };
        }
      },
    }),
  };
}


async function runSellerAgentNegotiation(args: {
  buyerCart: CartLine[];
  catalog: ProductRow[];
  upsells: UpsellRow[];
  sellerCaps: Caps;
  ledger: Ledger;
  sessionId: string;
}): Promise<{
  pitch: string;
  addedSku: string | null;
  discountBps: number;
  discountPaise: number;
  proposedCart: CartLine[];
}> {
  const { buyerCart, catalog, upsells, sellerCaps, ledger, sessionId } = args;

  // Check matching upsell rule deterministically for fallback
  const match = upsells.find(
    (r) =>
      (r.trigger_sku && buyerCart.some((l) => l.sku === r.trigger_sku)) ||
      (r.trigger_category && buyerCart.some((l) => l.category === r.trigger_category)),
  );
  const suggestion = match ? catalog.find((p) => p.sku === match.suggested_sku) : undefined;
  const fallbackBps = match ? Math.min(match.max_discount_bps, sellerCaps.max_discount_bps) : 0;

  const state: SellerAgentState = {
    appliedDiscountBps: 0,
    appliedDiscountPaise: 0,
    addedSku: suggestion && !buyerCart.some((l) => l.sku === suggestion.sku) ? suggestion.sku : null,
    createdOrderId: null,
    createdPaymentLinkId: null,
  };

  const sellerTools = createSellerTools({
    ledger,
    catalog,
    upsells,
    sellerCaps,
    sessionId,
    state,
    buyerCart,
  });

  const ai = createAgentAiProvider();
  if (!ai) {
    // Deterministic fallback when no AI key is present
    if (match && suggestion && !buyerCart.some((l) => l.sku === suggestion.sku)) {
      const decision = evaluateSellerDiscount({
        discountBps: fallbackBps,
        ruleMaxBps: match.max_discount_bps,
        caps: sellerCaps,
      });
      await ledger.decisions("seller", "apply_discount", [decision]);

      const proposedCart: CartLine[] = [
        ...buyerCart,
        {
          sku: suggestion.sku,
          title: suggestion.title,
          qty: 1,
          unit_price_paise: suggestion.price_paise,
          category: suggestion.category,
        },
      ];
      const proposedDiscount = Math.round((cartSubtotal(proposedCart) * fallbackBps) / 10000);
      const pitch = `Add ${suggestion.title} to this order and I'll apply ${fallbackBps / 100}% off the bundle. ${match.rationale}`;

      return {
        pitch,
        addedSku: suggestion.sku,
        discountBps: fallbackBps,
        discountPaise: proposedDiscount,
        proposedCart,
      };
    }

    return {
      pitch: "No cross-sell rule matched this cart. Quoting list price.",
      addedSku: null,
      discountBps: 0,
      discountPaise: 0,
      proposedCart: buyerCart,
    };
  }

  const prompt = [
    "You are the SELLER AGENT for Kalakriti Gift Co., negotiating with an AI Buyer Agent.",
    "Your merchant goals:",
    "1. Inspect the buyer's proposed cart with `quote_cart` to see item subtotals and check if any merchandising upsell rule is triggered.",
    "2. If an upsell rule applies and the suggested item is not already in the cart, propose adding 1 unit of that SKU.",
    "3. Use `apply_discount` to authorize a bundle discount within your authority ceiling (`rule_max_bps` and seller policy cap). If denied, adjust and re-apply.",
    "4. Respond with a concise, professional counter-offer pitch (max 45 words, plain text, no markdown) detailing the added product and discount.",
    "5. If no upsell rule applies, explain that you quote list price.",
    "",
    `Buyer's Proposed Cart: ${buyerCart.map((l) => `${l.qty}x ${l.title} (${l.sku})`).join(", ")}.`,
  ].join("\n");

  try {
    const response = await callWithBackoff(
      "sellerAgentNegotiation",
      async (attempt) => {
        return await generateText({
          model: ai.provider(ai.modelName),
          tools: sellerTools,
          stopWhen: isStepCount(5),
          prompt,
        });
      },
      3,
      [2000, 5000, 10000],
    );

    let finalCart = [...buyerCart];
    if (state.addedSku && !finalCart.some((l) => l.sku === state.addedSku)) {
      const addedProd = catalog.find((p) => p.sku === state.addedSku);
      if (addedProd) {
        finalCart.push({
          sku: addedProd.sku,
          title: addedProd.title,
          qty: 1,
          unit_price_paise: addedProd.price_paise,
          category: addedProd.category,
        });
      }
    }

    const calculatedDiscount =
      state.appliedDiscountBps > 0
        ? Math.round((cartSubtotal(finalCart) * state.appliedDiscountBps) / 10000)
        : state.appliedDiscountPaise;

    const pitch =
      response.text.trim() ||
      (suggestion
        ? `Add ${suggestion.title} to this order and I'll apply ${fallbackBps / 100}% off the bundle. ${match?.rationale ?? ""}`
        : "No cross-sell rule matched this cart. Quoting list price.");

    return {
      pitch,
      addedSku: state.addedSku,
      discountBps: state.appliedDiscountBps,
      discountPaise: calculatedDiscount,
      proposedCart: finalCart,
    };
  } catch (error) {
    logAiCallError("sellerPitch", error);

    // Graceful fallback if model tool call encounters an error
    if (match && suggestion && !buyerCart.some((l) => l.sku === suggestion.sku)) {
      const decision = evaluateSellerDiscount({
        discountBps: fallbackBps,
        ruleMaxBps: match.max_discount_bps,
        caps: sellerCaps,
      });
      await ledger.decisions("seller", "apply_discount", [decision]);

      const proposedCart: CartLine[] = [
        ...buyerCart,
        {
          sku: suggestion.sku,
          title: suggestion.title,
          qty: 1,
          unit_price_paise: suggestion.price_paise,
          category: suggestion.category,
        },
      ];
      const proposedDiscount = Math.round((cartSubtotal(proposedCart) * fallbackBps) / 10000);
      const pitch = `Add ${suggestion.title} to this order and I'll apply ${fallbackBps / 100}% off the bundle. ${match.rationale}`;

      return {
        pitch,
        addedSku: suggestion.sku,
        discountBps: fallbackBps,
        discountPaise: proposedDiscount,
        proposedCart,
      };
    }

    return {
      pitch: "No cross-sell rule matched this cart. Quoting list price.",
      addedSku: null,
      discountBps: 0,
      discountPaise: 0,
      proposedCart: buyerCart,
    };
  }
}

/* ------------------------------------------------------------------ */
/* Orchestrator                                                        */
/* ------------------------------------------------------------------ */

export async function runAgentSession(input: { brief: string; budgetPaise: number; mode: RunMode }) {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { initInMemorySession, memoryStore } = await import("./session-store");
  const admin = supabaseAdmin;
  const apiKey = process.env["LOVABLE_API_KEY"];

  const mandateBudgetPaise = input.budgetPaise;
  const planningBudgetPaise = input.mode === "overcap" ? Math.max(input.budgetPaise, 800000) : input.budgetPaise;

  let sessionId: string | null = null;
  try {
    const { data: session } = await admin
      .from("agent_sessions")
      .insert({
        brief: input.brief,
        mandate: { budget_paise: mandateBudgetPaise, mode: input.mode, currency: "INR" },
        status: "running",
      })
      .select("id")
      .single();
    if (session) sessionId = session.id as string;
  } catch {
    // Ignore DB insert failure, use fallback
  }

  if (!sessionId) {
    sessionId = crypto.randomUUID();
  }

  const memSession = initInMemorySession(sessionId, input.brief, { budget_paise: mandateBudgetPaise, mode: input.mode, currency: "INR" });
  const ledger = new Ledger(admin, sessionId);

  try {
    await ledger.event("system", "session.start", `Session opened for brief: ${input.brief}`, {
      budget_paise: mandateBudgetPaise,
      mode: input.mode,
    });

    const [{ data: products }, { data: rules }, { data: caps }] = await Promise.all([
      admin.from("products").select("*").order("price_paise", { ascending: false }),
      admin.from("upsell_rules").select("*").eq("active", true),
      admin.from("policy_caps").select("*"),
    ]);

    const catalog = (products ?? []) as ProductRow[];
    const upsells = (rules ?? []) as UpsellRow[];
    const buyerCaps = (caps ?? []).find((c) => c.scope === "buyer") as unknown as Caps;
    const sellerCaps = (caps ?? []).find((c) => c.scope === "seller") as unknown as Caps;

    await ledger.event("buyer", "discovery.catalog", `Fetched agent-readable catalog: ${catalog.length} SKUs.`, {
      endpoint: "/api/public/agent/catalog",
      skus: catalog.length,
    });
    await ledger.event("buyer", "discovery.manifest", "Read the merchant capability manifest.", {
      endpoint: "/api/public/agent/manifest",
      capabilities: ["search_catalog", "quote_cart", "negotiate", "create_payment_order"],
    });

    /* ---------- Turn 1: buyer proposes ---------- */
    const plan = await planCart({ brief: input.brief, budgetPaise: planningBudgetPaise, products: catalog });
    let cart: CartLine[] = plan.lines.flatMap((l) => {
      const p = catalog.find((c) => c.sku === l.sku);
      if (!p) return [];
      return [{ sku: p.sku, title: p.title, qty: l.qty, unit_price_paise: p.price_paise, category: p.category }];
    });

    await ledger.message(
      "buyer",
      "propose",
      1,
      `${plan.rationale} Proposed cart: ${cart.map((l) => `${l.qty}x ${l.title}`).join(", ")}.`,
      { cart, subtotal_paise: cartSubtotal(cart), planner: plan.source },
    );

    /* ---------- Turn 2: seller counters with tool-calling agent ---------- */
    const sellerResult = await runSellerAgentNegotiation({
      buyerCart: cart,
      catalog,
      upsells,
      sellerCaps,
      ledger,
      sessionId,
    });

    let discountPaise = sellerResult.discountPaise;
    let discountBps = sellerResult.discountBps;
    const proposedCart = sellerResult.proposedCart;

    if (sellerResult.addedSku && proposedCart.length > cart.length) {
      await ledger.message("seller", "counter", 2, sellerResult.pitch, {
        add_sku: sellerResult.addedSku,
        discount_bps: discountBps,
        discount_paise: discountPaise,
        new_total_paise: cartSubtotal(proposedCart) - discountPaise,
      });

      // Buyer accepts the upsell only if it still fits the planning budget.
      const wouldFit = cartSubtotal(proposedCart) - discountPaise <= planningBudgetPaise;
      if (wouldFit) {
        cart = proposedCart;
        await ledger.message(
          "buyer",
          "accept",
          3,
          `Accepting the cross-sell: ${sellerResult.addedSku} plus ${discountBps / 100}% bundle discount keeps the order inside my mandate.`,
          { cart, discount_paise: discountPaise },
        );
      } else {
        await ledger.message(
          "buyer",
          "refuse",
          3,
          `Declining the cross-sell. Adding ${sellerResult.addedSku} would push the total past my mandate budget even with the ${discountBps / 100}% discount.`,
          { rejected_sku: sellerResult.addedSku },
        );
        discountBps = 0;
        discountPaise = 0;
      }
    } else {
      await ledger.message("seller", "counter", 2, sellerResult.pitch, {});
    }

    /* ---------- Policy gate ---------- */
    let decisions = evaluateBuyerCart({ cart, discountPaise, caps: buyerCaps, budgetPaise: mandateBudgetPaise, attempts: 0 });
    await ledger.decisions("buyer", "authorize_payment", decisions);
    let verdict = worstVerdict(decisions);
    let replanned = false;

    if (verdict !== "allow") {
      replanned = true;
      await ledger.message(
        "buyer",
        "refuse",
        4,
        `Policy gate blocked this cart. ${decisions.find((d) => d.verdict !== "allow")?.reason ?? ""} Re-planning within the mandate instead of retrying the same action.`,
        { verdict, decisions },
      );

      const trimmed = trimCartToBudget(cart, mandateBudgetPaise);
      discountPaise = 0;
      cart = trimmed;
      decisions = evaluateBuyerCart({ cart, discountPaise, caps: buyerCaps, budgetPaise: mandateBudgetPaise, attempts: 0 });
      await ledger.decisions("buyer", "authorize_payment_retry", decisions);
      verdict = worstVerdict(decisions);

      await ledger.message(
        "buyer",
        verdict === "allow" ? "revise" : "refuse",
        5,
        verdict === "allow"
          ? `Re-planned to a compliant cart: ${cart.map((l) => `${l.qty}x ${l.title}`).join(", ")}.`
          : "No compliant cart exists inside this mandate. Escalating to the human principal rather than spending.",
        { cart, verdict },
      );
    }

    const subtotal = cartSubtotal(cart);
    const amount = Math.max(0, subtotal - discountPaise);

    if (verdict !== "allow") {
      const blockedOrder = {
        id: crypto.randomUUID(),
        session_id: sessionId,
        cart: cart as unknown,
        subtotal_paise: subtotal,
        discount_paise: discountPaise,
        amount_paise: amount,
        currency: "INR",
        razorpay_order_id: null,
        razorpay_payment_id: null,
        razorpay_link_url: null,
        status: "blocked",
        failure_reason: "Blocked by policy gate before any money action.",
        attempts: 0,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      };
      memSession.orders.push(blockedOrder);
      memSession.session.status = "blocked";
      memSession.session.outcome = "Policy gate refused the purchase. No payment was attempted.";

      try {
        await admin.from("orders").insert({
          session_id: sessionId,
          cart: asJson(cart),
          subtotal_paise: subtotal,
          discount_paise: discountPaise,
          amount_paise: amount,
          status: "blocked",
          failure_reason: "Blocked by policy gate before any money action.",
        });
        await admin
          .from("agent_sessions")
          .update({ status: "blocked", outcome: "Policy gate refused the purchase. No payment was attempted." })
          .eq("id", sessionId);
      } catch {}

      await ledger.event("system", "session.end", "Session ended without a money action.", { verdict });
      return { sessionId, status: "blocked" as const };
    }

    /* ---------- Money action: Razorpay test mode ---------- */
    const orderId = crypto.randomUUID();
    const orderObj = {
      id: orderId,
      session_id: sessionId,
      cart: cart as unknown,
      subtotal_paise: subtotal,
      discount_paise: discountPaise,
      amount_paise: amount,
      currency: "INR",
      razorpay_order_id: null as string | null,
      razorpay_payment_id: null as string | null,
      razorpay_link_url: null as string | null,
      status: "authorized",
      failure_reason: null as string | null,
      attempts: 1,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };
    memSession.orders.push(orderObj);

    try {
      await admin.from("orders").insert({
        id: orderId,
        session_id: sessionId,
        cart: asJson(cart),
        subtotal_paise: subtotal,
        discount_paise: discountPaise,
        amount_paise: amount,
        status: "authorized",
        attempts: 1,
      });
    } catch {}

    // In payment_failure mode the agent deliberately submits an invalid amount so
    // the real Razorpay API rejects it and we can show graceful recovery.
    const chargeAmount = input.mode === "payment_failure" ? 0 : amount;

    await ledger.event("buyer", "payment.authorized", `Buyer agent authorised a charge of ${amount} paise.`, {
      order_id: orderId,
      amount_paise: amount,
      within_caps: true,
    });

    try {
      const rzpOrder = await razorpayCreateOrder({
        amountPaise: chargeAmount,
        receipt: orderId.slice(0, 40),
        notes: { session_id: sessionId, agent: "buyer-agent" },
      });
      orderObj.razorpay_order_id = rzpOrder.id;

      await ledger.event("seller", "razorpay.order_created", `Razorpay test order ${rzpOrder.id} created.`, {
        razorpay_order_id: rzpOrder.id,
        amount: rzpOrder.amount,
        status: rzpOrder.status,
      });

      let linkUrl: string | null = null;
      try {
        const link = await razorpayCreatePaymentLink({
          amountPaise: chargeAmount,
          description: `Agentic order ${orderId.slice(0, 8)}`,
          referenceId: orderId,
          notes: { session_id: sessionId },
        });
        linkUrl = link.short_url;
        orderObj.razorpay_link_url = linkUrl;
        await ledger.event("seller", "razorpay.link_created", "Agent-payable checkout link issued.", {
          payment_link_id: link.id,
          short_url: link.short_url,
        });
      } catch (linkError) {
        const message = linkError instanceof RazorpayError ? linkError.message : String(linkError);
        await ledger.event("seller", "razorpay.link_failed", `Payment link could not be issued: ${message}`, {
          recoverable: true,
        });
      }

      orderObj.status = "awaiting_payment";
      const completionOutcome = replanned
        ? "Completed after a policy-driven re-plan. Razorpay test order created and awaiting settlement."
        : "Completed. Razorpay test order created and awaiting settlement.";

      memSession.session.status = "completed";
      memSession.session.outcome = completionOutcome;

      try {
        await admin
          .from("orders")
          .update({
            razorpay_order_id: rzpOrder.id,
            razorpay_link_url: linkUrl,
            status: "awaiting_payment",
          })
          .eq("id", orderId);

        await admin
          .from("agent_sessions")
          .update({
            status: "completed",
            outcome: completionOutcome,
          })
          .eq("id", sessionId);
      } catch {}

      await ledger.message(
        "seller",
        "settle",
        6,
        `Order confirmed. Razorpay test order ${rzpOrder.id} is open for ${amount} paise${linkUrl ? " with a payable checkout link" : ""}.`,
        { razorpay_order_id: rzpOrder.id, short_url: linkUrl },
      );
      await ledger.event("system", "session.end", "Session completed with a bounded, audited money action.", {
        amount_paise: amount,
      });

      return { sessionId, status: "completed" as const };
    } catch (payError) {
      const message = payError instanceof RazorpayError ? payError.message : String(payError);
      const status = payError instanceof RazorpayError ? payError.status : 0;

      orderObj.status = "failed";
      orderObj.failure_reason = message;
      const failureOutcome = `Payment failed gracefully: ${message}. No money moved, no blind retry, full trail recorded.`;

      memSession.session.status = "failed";
      memSession.session.outcome = failureOutcome;

      await ledger.event("system", "razorpay.error", `Payment gateway rejected the charge: ${message}`, {
        http_status: status,
        retryable: false,
      });
      await ledger.message(
        "buyer",
        "refuse",
        6,
        `Payment failed at the gateway (${message}). Attempt budget allows a retry, but the failure is a validation error, not a transient one — retrying the identical charge would fail identically, so I am stopping and handing back to the human principal.`,
        { error: message, http_status: status },
      );

      try {
        await admin
          .from("orders")
          .update({ status: "failed", failure_reason: message })
          .eq("id", orderId);
        await admin
          .from("agent_sessions")
          .update({
            status: "failed",
            outcome: failureOutcome,
          })
          .eq("id", sessionId);
      } catch {}

      await ledger.event("system", "session.end", "Session ended after a handled payment failure.", {});

      return { sessionId, status: "failed" as const };
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await ledger.event("system", "session.error", `Unhandled error: ${message}`, {});
    await admin.from("agent_sessions").update({ status: "failed", outcome: message }).eq("id", sessionId);
    return { sessionId, status: "failed" as const };
  }
}

/* ------------------------------------------------------------------ */
/* External-agent negotiation (used by /api/public/agent/negotiate)    */
/* ------------------------------------------------------------------ */

export async function negotiateForExternalAgent(input: {
  items: { sku: string; qty: number }[];
  budgetPaise?: number | undefined;
}) {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const admin = supabaseAdmin;

  const [{ data: products }, { data: rules }, { data: caps }] = await Promise.all([
    admin.from("products").select("*"),
    admin.from("upsell_rules").select("*").eq("active", true),
    admin.from("policy_caps").select("*").eq("scope", "seller").limit(1),
  ]);

  const catalog = (products ?? []) as ProductRow[];
  const sellerCaps = (caps ?? [])[0] as unknown as Caps | undefined;

  const lines: CartLine[] = input.items.flatMap((i) => {
    const p = catalog.find((c) => c.sku === i.sku);
    if (!p) return [];
    return [
      {
        sku: p.sku,
        title: p.title,
        qty: Math.max(1, Math.min(5, Math.round(i.qty || 1))),
        unit_price_paise: p.price_paise,
        category: p.category,
      },
    ];
  });

  if (lines.length === 0) {
    return { accepted: false, reason: "No known SKUs in the request.", quote: null };
  }

  const match = ((rules ?? []) as UpsellRow[]).find(
    (r) =>
      (r.trigger_sku && lines.some((l) => l.sku === r.trigger_sku)) ||
      (r.trigger_category && lines.some((l) => l.category === r.trigger_category)),
  );
  const suggestion = match ? catalog.find((p) => p.sku === match.suggested_sku) : undefined;
  const discountBps = match && sellerCaps ? Math.min(match.max_discount_bps, sellerCaps.max_discount_bps) : 0;

  const subtotal = cartSubtotal(lines);

  return {
    accepted: true,
    quote: {
      currency: "INR",
      lines,
      subtotal_paise: subtotal,
      total_paise: subtotal,
      expires_in_seconds: 900,
    },
    counter_offer:
      suggestion && discountBps > 0
        ? {
            add: {
              sku: suggestion.sku,
              title: suggestion.title,
              price_paise: suggestion.price_paise,
            },
            discount_bps: discountBps,
            rationale: match?.rationale ?? "",
            bundle_total_paise:
              subtotal +
              suggestion.price_paise -
              Math.round(((subtotal + suggestion.price_paise) * discountBps) / 10000),
          }
        : null,
    seller_policy: sellerCaps
      ? {
          max_order_total_paise: sellerCaps.max_order_total_paise,
          max_discount_bps: sellerCaps.max_discount_bps,
        }
      : null,
  };
}

/* ------------------------------------------------------------------ */
/* External-agent order creation (used by /api/public/agent/order)     */
/* ------------------------------------------------------------------ */

export async function createOrderForExternalAgent(input: {
  items: { sku: string; qty: number }[];
  budgetPaise?: number | undefined;
  idempotencyKey: string;
}) {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { memoryStore, initInMemorySession } = await import("./session-store");
  const admin = supabaseAdmin;

  // 1. Idempotency Check: check if order with this external_reference already exists
  let existingOrder: {
    id: string;
    session_id: string | null;
    razorpay_order_id: string | null;
    razorpay_link_url: string | null;
    amount_paise: number;
    status: string;
    failure_reason?: string | null;
  } | null = null;

  try {
    const { data } = await admin
      .from("orders")
      .select("*")
      .eq("external_reference", input.idempotencyKey)
      .maybeSingle();
    if (data) existingOrder = data;
  } catch {
    // Resilient fallback
  }

  if (!existingOrder) {
    const memMatch = Array.from(memoryStore.values())
      .flatMap((b) => b.orders)
      .find((o) => o.external_reference === input.idempotencyKey);
    if (memMatch) existingOrder = memMatch;
  }

  if (existingOrder) {
    return {
      success: true as const,
      status: 200,
      body: {
        session_id: existingOrder.session_id,
        razorpay_order_id: existingOrder.razorpay_order_id,
        payment_link_url: existingOrder.razorpay_link_url,
        amount_paise: existingOrder.amount_paise,
        status: existingOrder.status,
        audit_url: existingOrder.session_id ? `/audit/${existingOrder.session_id}` : null,
        idempotent_replay: true,
      },
    };
  }

  // 2. Fetch catalog, upsell rules, and policy caps
  const [{ data: products }, { data: rules }, { data: caps }] = await Promise.all([
    admin.from("products").select("*").order("price_paise", { ascending: false }),
    admin.from("upsell_rules").select("*").eq("active", true),
    admin.from("policy_caps").select("*"),
  ]);

  const catalog = (products ?? []) as ProductRow[];
  const sellerCaps = ((caps ?? []).find((c) => c.scope === "seller") ?? (caps ?? [])[0]) as unknown as Caps;

  // 3. Build cart lines from requested items
  const lines: CartLine[] = input.items.flatMap((i) => {
    const p = catalog.find((c) => c.sku === i.sku);
    if (!p) return [];
    return [
      {
        sku: p.sku,
        title: p.title,
        qty: Math.max(1, Math.min(5, Math.round(i.qty || 1))),
        unit_price_paise: p.price_paise,
        category: p.category,
      },
    ];
  });

  if (lines.length === 0) {
    return {
      success: false as const,
      status: 422,
      body: {
        error: "no_valid_items",
        message: "None of the requested item SKUs were found in the catalog.",
      },
    };
  }

  // 4. Create session & initialize Ledger
  const brief = `External agent purchase: ${lines.map((l) => `${l.qty}x ${l.sku}`).join(", ")}`;
  let sessionId: string | null = null;
  try {
    const { data: session } = await admin
      .from("agent_sessions")
      .insert({
        brief,
        mandate: { budget_paise: input.budgetPaise ?? null, currency: "INR" },
        origin: "external_agent",
        status: "running",
      })
      .select("id")
      .single();
    if (session) sessionId = session.id as string;
  } catch {
    // Ignore DB insert failure, use memory fallback
  }

  if (!sessionId) {
    sessionId = crypto.randomUUID();
  }

  const memSession = initInMemorySession(
    sessionId,
    brief,
    { budget_paise: input.budgetPaise ?? null, currency: "INR" },
    "external_agent",
  );
  const ledger = new Ledger(admin, sessionId);

  // 5. Log discovery events and proposed cart
  await ledger.event("system", "session.start", `Session opened for external agent: ${brief}`, {
    budget_paise: input.budgetPaise ?? null,
    origin: "external_agent",
  });
  await ledger.event("buyer", "discovery.catalog", `Fetched agent-readable catalog: ${catalog.length} SKUs.`, {
    endpoint: "/api/public/agent/catalog",
    skus: catalog.length,
  });
  await ledger.event("buyer", "discovery.manifest", "Read the merchant capability manifest.", {
    endpoint: "/api/public/agent/manifest",
    capabilities: ["search_catalog", "quote_cart", "negotiate", "create_payment_order"],
  });

  const subtotal = cartSubtotal(lines);
  await ledger.message(
    "buyer",
    "propose",
    1,
    `External agent submitted purchase intent: ${lines.map((l) => `${l.qty}x ${l.title}`).join(", ")}.`,
    { cart: lines, subtotal_paise: subtotal, planner: "external_agent" },
  );

  // 6. Policy Check
  const effectiveBudget = input.budgetPaise ?? sellerCaps.max_order_total_paise;
  const decisions = evaluateBuyerCart({
    cart: lines,
    discountPaise: 0,
    caps: sellerCaps,
    budgetPaise: effectiveBudget,
    attempts: 0,
  });

  await ledger.decisions("buyer", "authorize_payment", decisions);
  const verdict = worstVerdict(decisions);

  // 7. Refusal / Policy Block
  if (verdict !== "allow") {
    const failedDecision = decisions.find((d) => d.verdict !== "allow");
    const failReason = failedDecision?.reason ?? "Policy gate rejected the cart.";

    const blockedOrder = {
      id: crypto.randomUUID(),
      session_id: sessionId,
      cart: lines as unknown,
      subtotal_paise: subtotal,
      discount_paise: 0,
      amount_paise: subtotal,
      currency: "INR",
      razorpay_order_id: null,
      razorpay_payment_id: null,
      razorpay_link_url: null,
      status: "blocked",
      failure_reason: failReason,
      attempts: 0,
      external_reference: input.idempotencyKey,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };
    memSession.orders.push(blockedOrder);
    memSession.session.status = "blocked";
    memSession.session.outcome = `Policy gate refused the purchase: ${failReason}`;

    try {
      await admin.from("orders").insert({
        id: blockedOrder.id,
        session_id: sessionId,
        cart: asJson(lines),
        subtotal_paise: subtotal,
        discount_paise: 0,
        amount_paise: subtotal,
        status: "blocked",
        failure_reason: failReason,
        external_reference: input.idempotencyKey,
      });
      await admin
        .from("agent_sessions")
        .update({
          status: "blocked",
          outcome: `Policy gate refused the purchase: ${failReason}`,
        })
        .eq("id", sessionId);
    } catch {}

    await ledger.event("system", "session.end", "Session ended without a money action (policy gate refused purchase).", {
      verdict,
      reason: failReason,
    });

    return {
      success: false as const,
      status: 422,
      body: {
        error: "policy_rejected",
        reason: failReason,
        session_id: sessionId,
        decisions,
        audit_url: `/audit/${sessionId}`,
      },
    };
  }

  // 8. Approved - Execute Money Action via Razorpay
  const orderId = crypto.randomUUID();
  const amount = subtotal;

  await ledger.event("buyer", "payment.authorized", `External buyer agent authorized a charge of ${amount} paise.`, {
    order_id: orderId,
    amount_paise: amount,
    within_caps: true,
  });

  const rzpOrder = await razorpayCreateOrder({
    amountPaise: amount,
    receipt: orderId.slice(0, 40),
    notes: { session_id: sessionId, agent: "external-agent", idempotency_key: input.idempotencyKey },
  });

  await ledger.event("seller", "razorpay.order_created", `Razorpay test order ${rzpOrder.id} created.`, {
    razorpay_order_id: rzpOrder.id,
    amount: rzpOrder.amount,
    status: rzpOrder.status,
  });

  let linkUrl: string | null = null;
  try {
    const link = await razorpayCreatePaymentLink({
      amountPaise: amount,
      description: `Agentic order ${orderId.slice(0, 8)}`,
      referenceId: orderId,
      notes: { session_id: sessionId, idempotency_key: input.idempotencyKey },
    });
    linkUrl = link.short_url;
    await ledger.event("seller", "razorpay.link_created", "Agent-payable checkout link issued.", {
      payment_link_id: link.id,
      short_url: link.short_url,
    });
  } catch (linkError) {
    const message = linkError instanceof RazorpayError ? linkError.message : String(linkError);
    await ledger.event("seller", "razorpay.link_failed", `Payment link could not be issued: ${message}`, {
      recoverable: true,
    });
  }

  const orderObj = {
    id: orderId,
    session_id: sessionId,
    cart: lines as unknown,
    subtotal_paise: subtotal,
    discount_paise: 0,
    amount_paise: amount,
    currency: "INR",
    razorpay_order_id: rzpOrder.id,
    razorpay_payment_id: null,
    razorpay_link_url: linkUrl,
    status: "awaiting_payment",
    failure_reason: null,
    attempts: 1,
    external_reference: input.idempotencyKey,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };
  memSession.orders.push(orderObj);
  memSession.session.status = "completed";
  memSession.session.outcome = "Completed. Razorpay test order created for external agent and awaiting settlement.";

  try {
    await admin.from("orders").insert({
      id: orderId,
      session_id: sessionId,
      cart: asJson(lines),
      subtotal_paise: subtotal,
      discount_paise: 0,
      amount_paise: amount,
      status: "awaiting_payment",
      razorpay_order_id: rzpOrder.id,
      razorpay_link_url: linkUrl,
      attempts: 1,
      external_reference: input.idempotencyKey,
    });
    await admin
      .from("agent_sessions")
      .update({
        status: "completed",
        outcome: "Completed. Razorpay test order created for external agent and awaiting settlement.",
      })
      .eq("id", sessionId);
  } catch {}

  await ledger.message(
    "seller",
    "settle",
    2,
    `Order confirmed for external agent. Razorpay test order ${rzpOrder.id} is open for ${amount} paise${linkUrl ? " with a payable checkout link" : ""}.`,
    { razorpay_order_id: rzpOrder.id, short_url: linkUrl },
  );
  await ledger.event("system", "session.end", "Session completed with a bounded, audited money action.", {
    amount_paise: amount,
  });

  return {
    success: true as const,
    status: 200,
    body: {
      session_id: sessionId,
      razorpay_order_id: rzpOrder.id,
      payment_link_url: linkUrl,
      amount_paise: amount,
      status: "awaiting_payment",
      audit_url: `/audit/${sessionId}`,
    },
  };
}

