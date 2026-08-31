/**
 * Pure, dependency-free policy engine.
 *
 * Every money action in this app is evaluated here first. The engine never
 * performs an action — it only returns explainable verdicts that the audited
 * action layer enforces.
 */

export interface Caps {
  scope: string;
  max_order_total_paise: number;
  max_item_price_paise: number;
  max_discount_bps: number;
  max_payment_attempts: number;
  allowed_categories: string[];
}

export interface CartLine {
  sku: string;
  title: string;
  qty: number;
  unit_price_paise: number;
  category: string;
}

export type Verdict = "allow" | "deny" | "escalate";

export interface PolicyDecision {
  rule_name: string;
  inputs: Record<string, unknown>;
  verdict: Verdict;
  reason: string;
}

export function cartSubtotal(cart: CartLine[]): number {
  return cart.reduce((sum, l) => sum + l.unit_price_paise * l.qty, 0);
}

export function worstVerdict(decisions: PolicyDecision[]): Verdict {
  if (decisions.some((d) => d.verdict === "deny")) return "deny";
  if (decisions.some((d) => d.verdict === "escalate")) return "escalate";
  return "allow";
}

/** Buyer-side mandate check: does this cart fall inside what the agent is allowed to spend? */
export function evaluateBuyerCart(args: {
  cart: CartLine[];
  discountPaise: number;
  caps: Caps;
  budgetPaise: number;
  attempts: number;
}): PolicyDecision[] {
  const { cart, discountPaise, caps, budgetPaise, attempts } = args;
  const subtotal = cartSubtotal(cart);
  const total = Math.max(0, subtotal - discountPaise);
  const decisions: PolicyDecision[] = [];

  decisions.push(
    total <= budgetPaise
      ? {
          rule_name: "mandate.budget_ceiling",
          inputs: { total_paise: total, budget_paise: budgetPaise },
          verdict: "allow",
          reason: `Order total is within the mandate budget with ${budgetPaise - total} paise of headroom.`,
        }
      : {
          rule_name: "mandate.budget_ceiling",
          inputs: { total_paise: total, budget_paise: budgetPaise },
          verdict: "deny",
          reason: `Order total exceeds the mandate budget by ${total - budgetPaise} paise. The agent must re-plan a cheaper cart.`,
        },
  );

  decisions.push(
    total <= caps.max_order_total_paise
      ? {
          rule_name: "cap.max_order_total",
          inputs: { total_paise: total, cap_paise: caps.max_order_total_paise },
          verdict: "allow",
          reason: "Order total is inside the hard spend cap.",
        }
      : {
          rule_name: "cap.max_order_total",
          inputs: { total_paise: total, cap_paise: caps.max_order_total_paise },
          verdict: "escalate",
          reason: "Order total breaches the hard spend cap. Autonomous execution is suspended; a human must approve.",
        },
  );

  const overpriced = cart.filter((l) => l.unit_price_paise > caps.max_item_price_paise);
  decisions.push(
    overpriced.length === 0
      ? {
          rule_name: "cap.max_item_price",
          inputs: { cap_paise: caps.max_item_price_paise, lines: cart.length },
          verdict: "allow",
          reason: "Every line item is under the per-item price cap.",
        }
      : {
          rule_name: "cap.max_item_price",
          inputs: { cap_paise: caps.max_item_price_paise, offending: overpriced.map((l) => l.sku) },
          verdict: "deny",
          reason: `Line items ${overpriced.map((l) => l.sku).join(", ")} exceed the per-item price cap.`,
        },
  );

  const blocked = cart.filter((l) => !caps.allowed_categories.includes(l.category));
  decisions.push(
    blocked.length === 0
      ? {
          rule_name: "cap.category_allowlist",
          inputs: { allowed: caps.allowed_categories },
          verdict: "allow",
          reason: "All categories in the cart are on the mandate allowlist.",
        }
      : {
          rule_name: "cap.category_allowlist",
          inputs: { allowed: caps.allowed_categories, offending: blocked.map((l) => l.category) },
          verdict: "deny",
          reason: `Categories ${blocked.map((l) => l.category).join(", ")} are not on the mandate allowlist.`,
        },
  );

  decisions.push(
    attempts < caps.max_payment_attempts
      ? {
          rule_name: "cap.payment_attempts",
          inputs: { attempts, cap: caps.max_payment_attempts },
          verdict: "allow",
          reason: `Attempt ${attempts + 1} of ${caps.max_payment_attempts} allowed for this session.`,
        }
      : {
          rule_name: "cap.payment_attempts",
          inputs: { attempts, cap: caps.max_payment_attempts },
          verdict: "deny",
          reason: "Payment attempt budget for this session is exhausted. No further charges will be attempted.",
        },
  );

  return decisions;
}

/** Seller-side check: is the discount the seller agent wants to grant inside its authority? */
export function evaluateSellerDiscount(args: {
  discountBps: number;
  ruleMaxBps: number;
  caps: Caps;
}): PolicyDecision {
  const { discountBps, ruleMaxBps, caps } = args;
  const ceiling = Math.min(ruleMaxBps, caps.max_discount_bps);
  if (discountBps <= ceiling) {
    return {
      rule_name: "seller.discount_authority",
      inputs: { requested_bps: discountBps, rule_max_bps: ruleMaxBps, seller_cap_bps: caps.max_discount_bps },
      verdict: "allow",
      reason: `Discount of ${discountBps / 100}% is within the seller agent's ${ceiling / 100}% authority.`,
    };
  }
  return {
    rule_name: "seller.discount_authority",
    inputs: { requested_bps: discountBps, rule_max_bps: ruleMaxBps, seller_cap_bps: caps.max_discount_bps },
    verdict: "deny",
    reason: `Discount of ${discountBps / 100}% exceeds the seller agent's ${ceiling / 100}% authority. Clamped to the ceiling.`,
  };
}

/** Deterministic fallback / re-plan: drop the most expensive line until the cart fits. */
export function trimCartToBudget(cart: CartLine[], budgetPaise: number): CartLine[] {
  const working = [...cart].sort((a, b) => b.unit_price_paise * b.qty - a.unit_price_paise * a.qty);
  while (working.length > 1 && cartSubtotal(working) > budgetPaise) {
    working.shift();
  }
  return working;
}
