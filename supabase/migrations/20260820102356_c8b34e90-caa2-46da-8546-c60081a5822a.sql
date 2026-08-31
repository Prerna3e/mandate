-- =============== TABLES ===============

CREATE TABLE public.products (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  sku TEXT NOT NULL UNIQUE,
  title TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  price_paise BIGINT NOT NULL CHECK (price_paise >= 0),
  stock INT NOT NULL DEFAULT 0,
  category TEXT NOT NULL,
  tags TEXT[] NOT NULL DEFAULT '{}',
  image_url TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT ON public.products TO anon, authenticated;
GRANT ALL ON public.products TO service_role;
ALTER TABLE public.products ENABLE ROW LEVEL SECURITY;
CREATE POLICY "products_public_read" ON public.products FOR SELECT TO anon, authenticated USING (true);

CREATE TABLE public.upsell_rules (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  trigger_category TEXT,
  trigger_sku TEXT,
  suggested_sku TEXT NOT NULL,
  rationale TEXT NOT NULL DEFAULT '',
  max_discount_bps INT NOT NULL DEFAULT 0 CHECK (max_discount_bps BETWEEN 0 AND 10000),
  active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT ON public.upsell_rules TO anon, authenticated;
GRANT ALL ON public.upsell_rules TO service_role;
ALTER TABLE public.upsell_rules ENABLE ROW LEVEL SECURITY;
CREATE POLICY "upsell_rules_public_read" ON public.upsell_rules FOR SELECT TO anon, authenticated USING (true);

CREATE TABLE public.policy_caps (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  scope TEXT NOT NULL UNIQUE,
  max_order_total_paise BIGINT NOT NULL,
  max_item_price_paise BIGINT NOT NULL,
  max_discount_bps INT NOT NULL,
  max_payment_attempts INT NOT NULL,
  allowed_categories TEXT[] NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT ON public.policy_caps TO anon, authenticated;
GRANT ALL ON public.policy_caps TO service_role;
ALTER TABLE public.policy_caps ENABLE ROW LEVEL SECURITY;
CREATE POLICY "policy_caps_public_read" ON public.policy_caps FOR SELECT TO anon, authenticated USING (true);

CREATE TABLE public.agent_sessions (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  brief TEXT NOT NULL,
  mandate JSONB NOT NULL DEFAULT '{}'::jsonb,
  status TEXT NOT NULL DEFAULT 'running',
  outcome TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT ALL ON public.agent_sessions TO anon, authenticated;
GRANT ALL ON public.agent_sessions TO service_role;
ALTER TABLE public.agent_sessions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "agent_sessions_public_read" ON public.agent_sessions FOR SELECT TO anon, authenticated USING (true);
CREATE POLICY "agent_sessions_public_all" ON public.agent_sessions FOR ALL TO anon, authenticated USING (true) WITH CHECK (true);

CREATE TABLE public.agent_messages (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  session_id UUID NOT NULL REFERENCES public.agent_sessions(id) ON DELETE CASCADE,
  turn INT NOT NULL DEFAULT 0,
  sender TEXT NOT NULL,
  kind TEXT NOT NULL,
  body TEXT NOT NULL DEFAULT '',
  payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX agent_messages_session_idx ON public.agent_messages(session_id, turn, created_at);
GRANT ALL ON public.agent_messages TO anon, authenticated;
GRANT ALL ON public.agent_messages TO service_role;
ALTER TABLE public.agent_messages ENABLE ROW LEVEL SECURITY;
CREATE POLICY "agent_messages_public_read" ON public.agent_messages FOR SELECT TO anon, authenticated USING (true);
CREATE POLICY "agent_messages_public_all" ON public.agent_messages FOR ALL TO anon, authenticated USING (true) WITH CHECK (true);

CREATE TABLE public.policy_decisions (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  session_id UUID NOT NULL REFERENCES public.agent_sessions(id) ON DELETE CASCADE,
  actor TEXT NOT NULL,
  action TEXT NOT NULL,
  rule_name TEXT NOT NULL,
  inputs JSONB NOT NULL DEFAULT '{}'::jsonb,
  verdict TEXT NOT NULL,
  reason TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX policy_decisions_session_idx ON public.policy_decisions(session_id, created_at);
GRANT ALL ON public.policy_decisions TO anon, authenticated;
GRANT ALL ON public.policy_decisions TO service_role;
ALTER TABLE public.policy_decisions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "policy_decisions_public_read" ON public.policy_decisions FOR SELECT TO anon, authenticated USING (true);
CREATE POLICY "policy_decisions_public_all" ON public.policy_decisions FOR ALL TO anon, authenticated USING (true) WITH CHECK (true);

CREATE TABLE public.orders (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  session_id UUID REFERENCES public.agent_sessions(id) ON DELETE SET NULL,
  cart JSONB NOT NULL DEFAULT '[]'::jsonb,
  subtotal_paise BIGINT NOT NULL DEFAULT 0,
  discount_paise BIGINT NOT NULL DEFAULT 0,
  amount_paise BIGINT NOT NULL DEFAULT 0,
  currency TEXT NOT NULL DEFAULT 'INR',
  razorpay_order_id TEXT,
  razorpay_payment_id TEXT,
  razorpay_link_url TEXT,
  status TEXT NOT NULL DEFAULT 'created',
  failure_reason TEXT,
  attempts INT NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX orders_session_idx ON public.orders(session_id);
CREATE INDEX orders_rzp_idx ON public.orders(razorpay_order_id);
GRANT ALL ON public.orders TO anon, authenticated;
GRANT ALL ON public.orders TO service_role;
ALTER TABLE public.orders ENABLE ROW LEVEL SECURITY;
CREATE POLICY "orders_public_read" ON public.orders FOR SELECT TO anon, authenticated USING (true);
CREATE POLICY "orders_public_all" ON public.orders FOR ALL TO anon, authenticated USING (true) WITH CHECK (true);

CREATE TABLE public.audit_events (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  session_id UUID REFERENCES public.agent_sessions(id) ON DELETE CASCADE,
  seq BIGSERIAL,
  actor TEXT NOT NULL,
  event_type TEXT NOT NULL,
  summary TEXT NOT NULL DEFAULT '',
  detail JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX audit_events_session_idx ON public.audit_events(session_id, seq);
GRANT ALL ON public.audit_events TO anon, authenticated;
GRANT ALL ON public.audit_events TO service_role;
ALTER TABLE public.audit_events ENABLE ROW LEVEL SECURITY;
CREATE POLICY "audit_events_public_read" ON public.audit_events FOR SELECT TO anon, authenticated USING (true);
CREATE POLICY "audit_events_public_all" ON public.audit_events FOR ALL TO anon, authenticated USING (true) WITH CHECK (true);

-- =============== updated_at trigger ===============

CREATE OR REPLACE FUNCTION public.set_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

CREATE TRIGGER products_updated_at BEFORE UPDATE ON public.products FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
CREATE TRIGGER upsell_rules_updated_at BEFORE UPDATE ON public.upsell_rules FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
CREATE TRIGGER policy_caps_updated_at BEFORE UPDATE ON public.policy_caps FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
CREATE TRIGGER agent_sessions_updated_at BEFORE UPDATE ON public.agent_sessions FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
CREATE TRIGGER orders_updated_at BEFORE UPDATE ON public.orders FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- =============== SEED DATA ===============

INSERT INTO public.products (sku, title, description, price_paise, stock, category, tags) VALUES
('GFT-CNDL-01', 'Sandalwood Soy Candle', 'Hand-poured soy candle, 40-hour burn, sandalwood and vetiver.', 89000, 42, 'home', ARRAY['gift','home','candle']),
('GFT-MUG-01',  'Stoneware Filter Coffee Mug', 'Matte stoneware 300ml mug, microwave safe.', 65000, 60, 'kitchen', ARRAY['gift','coffee','kitchen']),
('GFT-CHOC-01', 'Single Origin Chocolate Box', '12-piece 70% Idukki cacao assortment.', 120000, 25, 'food', ARRAY['gift','chocolate','food']),
('GFT-NOTE-01', 'Cotton Paper Notebook', 'A5 handmade cotton-paper notebook, 160 pages.', 45000, 80, 'stationery', ARRAY['gift','stationery']),
('GFT-PEN-01',  'Brass Fountain Pen', 'Solid brass body, fine nib, refillable converter.', 175000, 18, 'stationery', ARRAY['gift','premium','stationery']),
('GFT-TEA-01',  'First Flush Darjeeling Tin', '100g loose leaf, single-estate first flush.', 98000, 34, 'food', ARRAY['gift','tea','food']),
('GFT-SCRF-01', 'Handwoven Wool Scarf', 'Kullu handloom wool scarf, natural dyes.', 240000, 12, 'apparel', ARRAY['gift','premium','apparel']),
('GFT-WRAP-01', 'Block Print Gift Wrap Set', '5 sheets hand block-printed wrap plus jute twine.', 25000, 150, 'packaging', ARRAY['addon','packaging']),
('GFT-CARD-01', 'Letterpress Greeting Card', 'Cotton card stock, letterpress, blank inside.', 15000, 200, 'packaging', ARRAY['addon','packaging']),
('GFT-BOX-01',  'Keepsake Gift Box', 'Rigid magnetic-close box with tissue lining.', 35000, 90, 'packaging', ARRAY['addon','packaging']);

INSERT INTO public.upsell_rules (trigger_category, trigger_sku, suggested_sku, rationale, max_discount_bps) VALUES
(NULL, 'GFT-CNDL-01', 'GFT-BOX-01', 'Candles are usually gifted; a keepsake box lifts perceived value.', 1000),
('food', NULL, 'GFT-WRAP-01', 'Edible gifts convert well with block-print wrap.', 1500),
(NULL, 'GFT-CHOC-01', 'GFT-CARD-01', 'A letterpress card pairs naturally with a chocolate box.', 2000),
('stationery', NULL, 'GFT-BOX-01', 'Premium stationery presents better boxed.', 1000);

INSERT INTO public.policy_caps (scope, max_order_total_paise, max_item_price_paise, max_discount_bps, max_payment_attempts, allowed_categories) VALUES
('buyer', 1000000, 500000, 10000, 2, ARRAY['home','kitchen','food','stationery','apparel','packaging']),
('seller', 1000000, 500000, 2000, 3, ARRAY['home','kitchen','food','stationery','apparel','packaging']);