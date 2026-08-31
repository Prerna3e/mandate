import { createClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";

function publicClient() {
  const key = process.env["SUPABASE_PUBLISHABLE_KEY"]!;
  return createClient<Database>(process.env["SUPABASE_URL"]!, key, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: {
      fetch: (input, init) => {
        const h = new Headers(init?.headers);
        if (key.startsWith("sb_") && h.get("Authorization") === `Bearer ${key}`) h.delete("Authorization");
        h.set("apikey", key);
        return fetch(input, { ...init, headers: h });
      },
    },
  });
}

export async function fetchCatalog() {
  const supabase = publicClient();
  const { data, error } = await supabase
    .from("products")
    .select("sku, title, description, price_paise, stock, category, tags")
    .order("price_paise", { ascending: false });
  if (error) throw new Error(error.message);
  return data ?? [];
}

export async function fetchMerchantConsole() {
  const supabase = publicClient();
  const [products, rules, caps, orders] = await Promise.all([
    supabase.from("products").select("*").order("price_paise", { ascending: false }),
    supabase.from("upsell_rules").select("*").order("created_at"),
    supabase.from("policy_caps").select("*").order("scope"),
    supabase.from("orders").select("*").order("created_at", { ascending: false }).limit(25),
  ]);
  return {
    products: products.data ?? [],
    rules: rules.data ?? [],
    caps: caps.data ?? [],
    orders: orders.data ?? [],
  };
}

export async function fetchSessionBundle(sessionId: string) {
  const supabase = publicClient();
  const [session, messages, decisions, events, orders] = await Promise.all([
    supabase.from("agent_sessions").select("*").eq("id", sessionId).maybeSingle(),
    supabase.from("agent_messages").select("*").eq("session_id", sessionId).order("turn").order("created_at"),
    supabase.from("policy_decisions").select("*").eq("session_id", sessionId).order("created_at"),
    supabase.from("audit_events").select("*").eq("session_id", sessionId).order("seq"),
    supabase.from("orders").select("*").eq("session_id", sessionId).order("created_at"),
  ]);

  if (session.data) {
    return {
      session: session.data ?? null,
      messages: messages.data ?? [],
      decisions: decisions.data ?? [],
      events: events.data ?? [],
      orders: orders.data ?? [],
    };
  }

  // Fallback to in-memory store if DB query returned null (e.g. RLS blocked write or local dev)
  const { getInMemorySessionBundle } = await import("./session-store");
  const mem = getInMemorySessionBundle(sessionId);
  if (mem) return mem;

  return {
    session: null,
    messages: [],
    decisions: [],
    events: [],
    orders: [],
  };
}

export async function fetchRecentSessions() {
  const supabase = publicClient();
  const { data } = await supabase
    .from("agent_sessions")
    .select("id, brief, status, outcome, created_at")
    .order("created_at", { ascending: false })
    .limit(10);
  return data ?? [];
}
