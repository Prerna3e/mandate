-- Add external_reference to orders for idempotency tracking
ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS external_reference TEXT UNIQUE;

-- Add origin to agent_sessions to distinguish internal vs external agent sessions
ALTER TABLE public.agent_sessions ADD COLUMN IF NOT EXISTS origin TEXT NOT NULL DEFAULT 'internal';
