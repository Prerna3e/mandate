export interface InMemorySessionBundle {
  session: {
    id: string;
    brief: string;
    mandate: Record<string, unknown>;
    origin?: string;
    status: string;
    outcome: string | null;
    created_at: string;
    updated_at: string;
  };
  messages: Array<{
    id: string;
    session_id: string;
    turn: number;
    sender: string;
    kind: string;
    body: string;
    payload: Record<string, unknown>;
    created_at: string;
  }>;
  decisions: Array<{
    id: string;
    session_id: string;
    actor: string;
    action: string;
    rule_name: string;
    inputs: Record<string, unknown>;
    verdict: string;
    reason: string;
    created_at: string;
  }>;
  events: Array<{
    id: string;
    session_id: string;
    seq: number;
    actor: string;
    event_type: string;
    summary: string;
    detail: Record<string, unknown>;
    created_at: string;
  }>;
  orders: Array<{
    id: string;
    session_id: string;
    cart: unknown;
    subtotal_paise: number;
    discount_paise: number;
    amount_paise: number;
    currency: string;
    razorpay_order_id: string | null;
    razorpay_payment_id: string | null;
    razorpay_link_url: string | null;
    status: string;
    failure_reason: string | null;
    attempts: number;
    external_reference?: string | null;
    created_at: string;
    updated_at: string;
  }>;
}

// Global in-memory cache to ensure session persistence across server runs even when DB RLS blocks write access
const globalStore = (globalThis as unknown as { __session_memory_store__?: Map<string, InMemorySessionBundle> });
if (!globalStore.__session_memory_store__) {
  globalStore.__session_memory_store__ = new Map<string, InMemorySessionBundle>();
}

export const memoryStore = globalStore.__session_memory_store__!;

export function getInMemorySessionBundle(sessionId: string): InMemorySessionBundle | null {
  return memoryStore.get(sessionId) ?? null;
}

export function initInMemorySession(
  sessionId: string,
  brief: string,
  mandate: Record<string, unknown>,
  origin = "internal",
): InMemorySessionBundle {
  const now = new Date().toISOString();
  const bundle: InMemorySessionBundle = {
    session: {
      id: sessionId,
      brief,
      mandate,
      origin,
      status: "running",
      outcome: null,
      created_at: now,
      updated_at: now,
    },
    messages: [],
    decisions: [],
    events: [],
    orders: [],
  };
  memoryStore.set(sessionId, bundle);
  return bundle;
}
