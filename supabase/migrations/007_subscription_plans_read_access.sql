-- Migration: Embed plan limits in profiles to avoid client querying subscription_plans
-- Root cause: subscription_plans was not GRANT-ed SELECT to authenticated role, causing 406.
-- Fix strategy: denormalize limit columns into profiles (synced by trigger) so the client
-- only needs to read the profiles row it already owns — no cross-table permission needed.
--
-- Also grants SELECT on subscription_plans as a belt-and-suspenders fallback.

-- ─── 1. Grant read on subscription_plans (public plan metadata, no sensitive data) ───
GRANT SELECT ON public.subscription_plans TO authenticated, anon;

-- ─── 2. Add plan limit columns to profiles ────────────────────────────────────
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS plan_stt_limit                INT NOT NULL DEFAULT 18000,
  ADD COLUMN IF NOT EXISTS plan_tts_chars_limit          INT NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS plan_ai_requests_limit        INT NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS plan_translate_requests_limit INT NOT NULL DEFAULT 0;

-- ─── 3. Backfill from subscription_plans for existing rows ────────────────────
UPDATE public.profiles p
SET
  plan_stt_limit                = sp.stt_seconds_limit,
  plan_tts_chars_limit          = sp.tts_chars_limit,
  plan_ai_requests_limit        = sp.ai_requests_limit,
  plan_translate_requests_limit = sp.translate_requests_limit
FROM public.subscription_plans sp
WHERE sp.name = p.plan;

-- ─── 4. Extend trigger to also sync the new limit columns ─────────────────────
-- Replaces the function created in migration 006. Adds plan_*_limit syncing.
CREATE OR REPLACE FUNCTION public.sync_profile_plan_limit()
RETURNS TRIGGER AS $$
DECLARE
  v_plan RECORD;
BEGIN
  SELECT
    stt_seconds_limit,
    tts_chars_limit,
    ai_requests_limit,
    translate_requests_limit
  INTO v_plan
  FROM public.subscription_plans
  WHERE name = NEW.plan;

  -- Sync STT limit (legacy column kept for backwards compat)
  NEW.trial_limit_seconds            := v_plan.stt_seconds_limit;
  -- Sync all denormalized limit columns
  NEW.plan_stt_limit                 := v_plan.stt_seconds_limit;
  NEW.plan_tts_chars_limit           := v_plan.tts_chars_limit;
  NEW.plan_ai_requests_limit         := v_plan.ai_requests_limit;
  NEW.plan_translate_requests_limit  := v_plan.translate_requests_limit;

  -- Reset all usage counters on any plan change
  NEW.trial_seconds_used        := 0;
  NEW.tts_chars_used            := 0;
  NEW.ai_requests_used          := 0;
  NEW.translate_requests_used   := 0;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
