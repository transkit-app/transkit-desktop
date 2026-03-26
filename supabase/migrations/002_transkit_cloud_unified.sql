-- Migration: Transkit Cloud Unified Provider
-- Introduces subscription_plans and cloud_service_config tables.
-- All credential generation is now routed through get-cloud-credentials edge function.

-- ─── 1. Subscription plans ────────────────────────────────────────────────────
-- Admin-managed. Edit via Supabase Table Editor — no app rebuild required.

CREATE TABLE IF NOT EXISTS public.subscription_plans (
  name                TEXT PRIMARY KEY,
  display_name        TEXT NOT NULL,
  stt_seconds_limit   INT  NOT NULL DEFAULT 18000,  -- -1 = unlimited
  tts_chars_limit     INT  NOT NULL DEFAULT 0,       -- 0 = not yet available
  ai_tokens_limit     INT  NOT NULL DEFAULT 0,       -- 0 = not yet available
  price_monthly_usd   NUMERIC(10,2) DEFAULT 0,
  is_active           BOOLEAN DEFAULT true
);

INSERT INTO public.subscription_plans (name, display_name, stt_seconds_limit, tts_chars_limit, ai_tokens_limit, price_monthly_usd)
VALUES
  ('trial',   'Free Trial',  18000,   0, 0,  0.00),
  ('starter', 'Starter',    180000,   0, 0,  9.99),
  ('pro',     'Pro',            -1,   0, 0, 29.99)
ON CONFLICT (name) DO NOTHING;

-- ─── 2. Cloud service config ──────────────────────────────────────────────────
-- Admin sets which provider handles each service type (stt / tts / ai).
-- provider_config stores only NON-SENSITIVE metadata (model name, options, etc.).
-- Master API keys are stored in Supabase Secrets (Deno.env), NEVER in this table.
-- Only edge functions (service_role) can read this table.
--
-- provider_config examples (no keys — keys live in Secrets):
--   deepgram → { "model": "nova-3" }
--   soniox   → {}
--   gladia   → { "model": "solaria-1" }
--
-- Set master keys with: supabase secrets set DEEPGRAM_MASTER_API_KEY=dg-xxxx

CREATE TABLE IF NOT EXISTS public.cloud_service_config (
  id              SERIAL PRIMARY KEY,
  service_type    TEXT    NOT NULL,              -- 'stt' | 'tts' | 'ai'
  provider_name   TEXT    NOT NULL,              -- 'deepgram' | 'soniox' | 'gladia' | ...
  provider_config JSONB   NOT NULL DEFAULT '{}', -- non-sensitive metadata only, e.g. { "model": "nova-3" }
  min_plan        TEXT    NOT NULL DEFAULT 'trial' REFERENCES public.subscription_plans(name),
  is_active       BOOLEAN DEFAULT true,
  updated_at      TIMESTAMPTZ DEFAULT NOW()
);

-- Only one active provider per service type at a time
CREATE UNIQUE INDEX IF NOT EXISTS cloud_service_config_active_idx
  ON public.cloud_service_config(service_type) WHERE is_active = true;

-- RLS: enable but add NO policies for authenticated users.
-- Edge functions run with service_role which bypasses RLS entirely.
-- This prevents any client from reading provider API keys.
ALTER TABLE public.cloud_service_config ENABLE ROW LEVEL SECURITY;

-- ─── 3. Extend profiles ───────────────────────────────────────────────────────
-- Add plan field (defaults to 'trial' for all existing users).
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS plan TEXT NOT NULL DEFAULT 'trial'
  REFERENCES public.subscription_plans(name);

-- ─── 4. Extend usage_sessions ─────────────────────────────────────────────────
-- Track which service type and provider were used per session.
ALTER TABLE public.usage_sessions
  ADD COLUMN IF NOT EXISTS service_type  TEXT NOT NULL DEFAULT 'stt';
ALTER TABLE public.usage_sessions
  ADD COLUMN IF NOT EXISTS provider_name TEXT;

-- ─── Notes ────────────────────────────────────────────────────────────────────
-- trial_seconds_used / trial_limit_seconds in profiles are kept as-is.
-- get-cloud-credentials reads them for quota enforcement (stt quota).
-- They will be aliased / renamed in a future migration when TTS/AI quotas are added.
--
-- Master API keys are stored in Supabase Secrets (NOT in this table).
-- provider_config holds only non-sensitive metadata (model name, options).
-- Set keys with: supabase secrets set DEEPGRAM_MASTER_API_KEY=dg-xxxx
--
-- Usage example — set Deepgram as active STT provider (run in SQL editor):
--
--   INSERT INTO public.cloud_service_config (service_type, provider_name, provider_config, is_active)
--   VALUES ('stt', 'deepgram', '{"model":"nova-3"}', true);
--
-- To switch providers: set is_active=false on existing row, insert new row.
