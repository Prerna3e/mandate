const RAZORPAY_BASE = "https://api.razorpay.com/v1";

export class RazorpayError extends Error {
  status: number;
  body: unknown;
  constructor(status: number, body: unknown, message: string) {
    super(message);
    this.name = "RazorpayError";
    this.status = status;
    this.body = body;
  }
}

function isSimulatedTestMode(): boolean {
  const id = process.env["RAZORPAY_KEY_ID"];
  const secret = process.env["RAZORPAY_KEY_SECRET"];
  return !id || !secret || id.includes("dummy") || id.includes("placeholder");
}

function authHeader(): string {
  const id = process.env["RAZORPAY_KEY_ID"];
  const secret = process.env["RAZORPAY_KEY_SECRET"];
  if (!id || !secret) {
    throw new RazorpayError(0, null, "Razorpay test-mode credentials are not configured on the server.");
  }
  return "Basic " + Buffer.from(`${id}:${secret}`).toString("base64");
}

async function call(path: string, init: RequestInit): Promise<Record<string, unknown>> {
  const res = await fetch(`${RAZORPAY_BASE}${path}`, {
    ...init,
    headers: {
      Authorization: authHeader(),
      "Content-Type": "application/json",
      ...(init.headers ?? {}),
    },
  });
  const text = await res.text();
  let parsed: unknown = text;
  try {
    parsed = JSON.parse(text);
  } catch {
    /* keep raw text */
  }
  if (!res.ok) {
    const description =
      (parsed as { error?: { description?: string } })?.error?.description ?? `Razorpay request failed (${res.status})`;
    throw new RazorpayError(res.status, parsed, description);
  }
  return parsed as Record<string, unknown>;
}

export interface RazorpayOrder {
  id: string;
  amount: number;
  currency: string;
  status: string;
  receipt: string | null;
}

export async function razorpayCreateOrder(args: {
  amountPaise: number;
  receipt: string;
  notes?: Record<string, string>;
}): Promise<RazorpayOrder> {
  if (args.amountPaise <= 0) {
    throw new RazorpayError(
      400,
      { error: { code: "BAD_REQUEST_ERROR", description: "Amount must be at least 100 paise." } },
      "BAD_REQUEST_ERROR: Amount must be at least 100 paise.",
    );
  }

  if (isSimulatedTestMode()) {
    const mockId = `order_rzp_test_${Math.random().toString(36).slice(2, 10)}`;
    return {
      id: mockId,
      amount: args.amountPaise,
      currency: "INR",
      status: "created",
      receipt: args.receipt,
    };
  }

  const data = await call("/orders", {
    method: "POST",
    body: JSON.stringify({
      amount: args.amountPaise,
      currency: "INR",
      receipt: args.receipt,
      notes: args.notes ?? {},
      payment_capture: 1,
    }),
  });
  return {
    id: String(data["id"]),
    amount: Number(data["amount"]),
    currency: String(data["currency"]),
    status: String(data["status"]),
    receipt: (data["receipt"] as string) ?? null,
  };
}

export async function razorpayCreatePaymentLink(args: {
  amountPaise: number;
  description: string;
  referenceId: string;
  notes?: Record<string, string>;
}): Promise<{ id: string; short_url: string; status: string }> {
  if (args.amountPaise <= 0) {
    throw new RazorpayError(
      400,
      { error: { code: "BAD_REQUEST_ERROR", description: "Amount must be at least 100 paise." } },
      "BAD_REQUEST_ERROR: Amount must be at least 100 paise.",
    );
  }

  if (isSimulatedTestMode()) {
    const mockLinkId = `plink_${Math.random().toString(36).slice(2, 10)}`;
    return {
      id: mockLinkId,
      short_url: `https://rzp.io/i/${mockLinkId.slice(6)}`,
      status: "created",
    };
  }

  const data = await call("/payment_links", {
    method: "POST",
    body: JSON.stringify({
      amount: args.amountPaise,
      currency: "INR",
      accept_partial: false,
      description: args.description.slice(0, 250),
      reference_id: args.referenceId,
      notify: { sms: false, email: false },
      reminder_enable: false,
      notes: args.notes ?? {},
    }),
  });
  return {
    id: String(data["id"]),
    short_url: String(data["short_url"]),
    status: String(data["status"]),
  };
}

export async function razorpayFetchOrder(orderId: string): Promise<RazorpayOrder> {
  const data = await call(`/orders/${orderId}`, { method: "GET" });
  return {
    id: String(data["id"]),
    amount: Number(data["amount"]),
    currency: String(data["currency"]),
    status: String(data["status"]),
    receipt: (data["receipt"] as string) ?? null,
  };
}
