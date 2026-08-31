# Agentic Commerce Console

> **Two agents. One merchant. Every rupee accounted for.**

An end-to-end reference implementation of **Policy-Gated Agent-to-Agent (A2A) Commerce** powered by Razorpay test mode. A buyer agent holding a spend mandate discovers a merchant's machine-readable catalog, negotiates with the merchant's seller agent, clears a deterministic policy gate, and settles a real Razorpay test-mode order with a complete, replayable audit trail.

---

## 🌟 Key Pillars

1. **Agent-Readable Merchant**
   - **Capability Manifest (`/api/public/agent/manifest`)**: Machine discovery endpoint detailing supported protocols, currencies, endpoints, and policy guardrails.
   - **Machine Catalog (`/api/public/agent/catalog`)**: Structured JSON catalog with prices in paise, real-time inventory, category metadata, and tags.
   - **Autonomous Negotiation (`/api/public/agent/negotiate`)**: Structured buyer intent submission, quote generation, and seller counter-offers.

2. **Bounded Money Actions (Policy Engine)**
   - Every financial action is evaluated by a pure, deterministic policy engine before any transaction occurs:
     - `mandate.budget_ceiling`: Validates cart against buyer-mandated spend limits.
     - `cap.max_order_total`: Prevents total cart breach; escalates to human approval if exceeded.
     - `cap.max_item_price`: Enforces single-item price ceilings.
     - `cap.category_allowlist`: Enforces category restrictions.
     - `cap.payment_attempts`: Caps retry attempts to prevent payment exhaustion attacks.
     - `seller.discount_authority`: Clamps seller upsell discounts to strict basis-point ceilings.

3. **Explainable Audit Trail**
   - Every agent dialogue turn, policy evaluation with exact inputs and rationale, and Razorpay API call is recorded on a sequenced, immutable ledger with full session replay.

---

## 🔄 Interaction Flow

```text
Buyer Agent                 Policy Gate                 Seller Agent            Razorpay (Test)
     │                           │                            │                        │
     ├──── Read Manifest ────────┼───────────────────────────►│                        │
     ├──── Plan Cart ───────────►│  Caps + Mandate Check      │                        │
     │                           ├─ Allow / Deny / Escalate   │                        │
     │◄─── Counter-Offer ────────┼────────────────────────────┤ Upsell with discount   │
     │                           │                            │ within authority       │
     ├──── Authorize Charge ────►│  Bounded Amount Gate ──────────────────────────────►│ Create Order + Link
     │                           │                            │                        │
     └──── Audit Trail ◄─────────┴────────────────────────────┴────────────────────────┘
```

---

## 🖥️ UI & Experiences

* **Agent Theatre (`/agent`)**: A live 3-pane operations console demonstrating the multi-turn negotiation, live policy gate verdicts, and settlement badges across three modes:
  * **Happy Path**: Compliant cart, upsell negotiation, and Razorpay payment link generation.
  * **Over-Cap Path**: Request breaches spend mandate, policy issues `deny`/`escalate`, and buyer agent autonomously re-plans.
  * **Gateway Failure Path**: Simulates payment failure, audits the attempt, and verifies retry limits.
* **Storefront (`/store`)**: The human customer view of *Kalakriti Gift Co.* (handcrafted Indian gifting) mirroring the identical data fed to autonomous agents.
* **Merchant Console (`/merchant`)**: Control plane for merchants to configure spend caps, discount authority, cross-sell/upsell rules, and inspect orders.
* **Audit Trail Explorer (`/audit/$sessionId`)**: Chronological audit log inspector with filtering across agent messages, policy decisions, audit events, and payment receipts.

---

## 🛠️ Tech Stack

* **Framework**: [TanStack Start](https://tanstack.com/start) (Full-stack SSR / Nitro engine)
* **Routing & State**: [TanStack Router](https://tanstack.com/router) & [TanStack Query](https://tanstack.com/query)
* **AI & LLM Orchestration**: [Vercel AI SDK](https://sdk.vercel.ai/) (`ai`) with Google Gemini / OpenAI-compatible models
* **Database & Auth**: [Supabase](https://supabase.com/) (PostgreSQL with Row Level Security)
* **Payment Gateway**: [Razorpay](https://razorpay.com/) (Test Mode API & Webhooks)
* **Styling & Components**: Tailwind CSS v4, Radix UI primitives, Lucide React, Sonner

---

## 📁 Project Structure

```
├── public/                     # Static assets
├── src/
│   ├── components/             # Reusable UI components & Console layout
│   │   ├── console-chrome.tsx  # Header, nav, terminal shells, chips
│   │   └── ui/                 # Radix UI design system primitives
│   ├── integrations/supabase/  # Supabase client and SSR auth helpers
│   ├── lib/
│   │   ├── agent-run.server.ts # Multi-turn LLM negotiation orchestration
│   │   ├── ai-gateway.server.ts# AI model providers (Gemini / OpenAI)
│   │   ├── money.ts            # Currency formatters and paise conversions
│   │   ├── policy.ts           # Pure deterministic policy engine & caps
│   │   ├── razorpay.server.ts  # Razorpay orders and payment link client
│   │   └── session-store.ts    # Resilient in-memory dual-write session ledger
│   └── routes/                 # File-based TanStack Start routes
│       ├── __root.tsx          # Root app shell
│       ├── index.tsx           # Landing page
│       ├── agent.tsx           # Agent Theatre 3-pane console
│       ├── store.tsx           # Storefront catalog
│       ├── merchant.tsx        # Merchant policy & rule admin console
│       ├── audit/$sessionId.tsx# Deep session audit viewer
│       └── api/public/         # Agent-facing public REST API
│           └── agent/          # Manifest, Catalog, Negotiate, Order endpoints
├── supabase/
│   └── migrations/             # PostgreSQL schema & RLS policies
├── .env.example                # Template for required environment variables
├── package.json
└── vite.config.ts
```

---

## 🚀 Getting Started

### 1. Clone the Repository
```bash
git clone https://github.com/Prerna3e/razorpay-agentic-commerce.git
cd razorpay-agentic-commerce
```

### 2. Install Dependencies
```bash
npm install
# or
bun install
```

### 3. Configure Environment Variables
Copy the `.env.example` file and populate with your credentials:
```bash
cp .env.example .env
```

| Variable | Description |
|---|---|
| `VITE_SUPABASE_URL` / `SUPABASE_URL` | Supabase Project URL |
| `VITE_SUPABASE_PUBLISHABLE_KEY` | Supabase anon/publishable key |
| `SUPABASE_SERVICE_ROLE_KEY` | Supabase service role secret |
| `RAZORPAY_KEY_ID` | Razorpay Key ID (`rzp_test_...`) |
| `RAZORPAY_KEY_SECRET` | Razorpay Key Secret |
| `GEMINI_API_KEY` | Google Gemini API Key for LLM negotiation |
| `EXTERNAL_AGENT_API_KEY` | Optional API key for authenticating third-party agent requests |

### 4. Database Setup
Apply the migrations in `supabase/migrations/` to your Supabase instance to create tables for products, upsell rules, policy caps, sessions, and audit events.

### 5. Run the Development Server
```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000) (or the port indicated in your console) to launch the Agentic Commerce Console.

---

## 📡 Public Agent API Reference

| Method | Endpoint | Description |
|---|---|---|
| `GET` | `/api/public/agent/manifest` | Capability manifest detailing merchant spec and policy rules |
| `GET` | `/api/public/agent/catalog` | Machine-readable product catalog with live stock and pricing |
| `POST` | `/api/public/agent/negotiate` | Submit structured buyer brief to receive binding quote and counter-offer |
| `POST` | `/api/public/agent/order` | Policy-gated money action creating a Razorpay test payment order |
| `POST` | `/api/public/razorpay/webhook` | Webhook handler for Razorpay asynchronous payment events |

---

## 🛡️ License

MIT License.
