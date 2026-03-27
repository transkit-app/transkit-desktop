-- Migration: Denormalize plan limits into profiles
-- Migration 007 was already applied (only contained GRANT SELECT).
-- This migration adds the 4 limit columns that the client now reads from profiles
-- instead of querying subscription_plans directly.

-- ─── 1. Add limit columns to profiles ────────────────────────────────────────
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS plan_stt_limit                INT NOT NULL DEFAULT 18000,
  ADD COLUMN IF NOT EXISTS plan_tts_chars_limit          INT NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS plan_ai_requests_limit        INT NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS plan_translate_requests_limit INT NOT NULL DEFAULT 0;

-- ─── 2. Revoke direct UPDATE on new limit columns (mirrors migration 003) ────
-- Prevents authenticated users from tampering with their own plan limits.
REVOKE UPDATE (
  plan_stt_limit,
  plan_tts_chars_limit,
  plan_ai_requests_limit,
  plan_translate_requests_limit
) ON public.profiles FROM authenticated;

-- ─── 3. Backfill existing rows from subscription_plans ───────────────────────
UPDATE public.profiles p
SET
  plan_stt_limit                = sp.stt_seconds_limit,
  plan_tts_chars_limit          = sp.tts_chars_limit,
  plan_ai_requests_limit        = sp.ai_requests_limit,
  plan_translate_requests_limit = sp.translate_requests_limit
FROM public.subscription_plans sp
WHERE sp.name = p.plan;

-- ─── 4. Update trigger to sync new limit columns on plan change ───────────────
-- Replaces the function originally created in migration 005 (STT only)
-- and updated in migration 006 (added usage reset for TTS/AI/Translate).
-- Now also sets the 4 denormalized limit columns.

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

  -- Sync STT limit (legacy column kept for backwards compat with edge functions)
  NEW.trial_limit_seconds            := v_plan.stt_seconds_limit;
  -- Sync denormalized limit columns read by the client
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
