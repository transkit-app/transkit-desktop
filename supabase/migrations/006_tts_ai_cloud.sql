-- Migration: Transkit Cloud TTS / AI / Translate Quotas
--
-- Extends the quota system to cover TTS (chars), AI suggestions (requests),
-- and Translation (requests). Previously only STT (seconds) was active.
--
-- ── Quota units ───────────────────────────────────────────────────────────────
--   STT       → seconds      (trial_seconds_used / trial_limit_seconds) — unchanged
--   TTS       → chars        (tts_chars_used     / tts_chars_limit)
--   AI        → requests     (ai_requests_used   / ai_requests_limit)
--   Translate → requests     (translate_requests_used / translate_requests_limit)
--
-- ── ai_tokens_limit repurposed ────────────────────────────────────────────────
--   Previously reserved as 0. Now used as max_tokens_per_request safety cap.
--   Stored per-plan so Pro users can get a higher cap (8000) vs Trial/Starter (4000).
--   Edge function reads this to truncate/split long inputs before calling Gemini.
--
-- ── Voice catalog (TTS) ───────────────────────────────────────────────────────
--   Admin stores voice catalog in cloud_service_config.provider_config:
--   {
--     "model": "eleven_flash_v2_5",
--     "voices": [
--       { "id": "auto",                  "label": "Auto (best for language)", "is_default": true },
--       { "id": "QqID1ZB0DTItNxAKGBNW", "label": "Rachel (Female, EN/VI)"  },
--       { "id": "21m00Tcm4TlvDq8ikWAM", "label": "Adam (Male, EN)"         }
--     ]
--   }
--   voice id is opaque provider-specific — client never constructs it.
--   Changing provider = admin updates voice catalog in DB; app picks up on next fetch.
--
-- ── Required Supabase Secrets ─────────────────────────────────────────────────
--   supabase secrets set ELEVENLABS_MASTER_API_KEY=sk-...
--   supabase secrets set GEMINI_MASTER_API_KEY=AIza...

-- ─── 1. Extend subscription_plans ────────────────────────────────────────────

ALTER TABLE public.subscription_plans
  ADD COLUMN IF NOT EXISTS tts_chars_limit         INT NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS ai_requests_limit        INT NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS translate_requests_limit INT NOT NULL DEFAULT 0;

-- ai_tokens_limit was reserved (all zeros). Repurpose as max_tokens_per_request.
-- Update values per plan. Existing column, just update the data.

UPDATE public.subscription_plans SET
  tts_chars_limit         = 3000,
  ai_requests_limit       = 50,
  translate_requests_limit = 200,
  ai_tokens_limit         = 4000   -- max tokens per single AI/translate request
WHERE name = 'trial';

UPDATE public.subscription_plans SET
  tts_chars_limit         = 30000,
  ai_requests_limit       = 2000,
  translate_requests_limit = 10000,
  ai_tokens_limit         = 4000
WHERE name = 'starter';

UPDATE public.subscription_plans SET
  tts_chars_limit         = -1,    -- unlimited
  ai_requests_limit       = -1,
  translate_requests_limit = -1,
  ai_tokens_limit         = 8000   -- higher cap for Pro
WHERE name = 'pro';

-- ─── 2. Extend profiles ───────────────────────────────────────────────────────

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS tts_chars_used          INT NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS ai_requests_used         INT NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS translate_requests_used  INT NOT NULL DEFAULT 0;

-- ─── 3. Column-level security on new quota columns ────────────────────────────
-- Mirrors the pattern from migration 003: authenticated users cannot directly
-- update these counters. Edge functions use service_role and bypass this.

REVOKE UPDATE (
  tts_chars_used,
  ai_requests_used,
  translate_requests_used
) ON public.profiles FROM authenticated;

-- ─── 4. RPC: debit_tts_usage ─────────────────────────────────────────────────
-- Atomically deduct character count from TTS quota.
-- Returns chars debited (0 = quota exhausted or limit is 0 = service not enabled).

DROP FUNCTION IF EXISTS public.debit_tts_usage(UUID, INT);

CREATE OR REPLACE FUNCTION public.debit_tts_usage(p_user_id UUID, p_chars INT)
RETURNS INT AS $$
DECLARE
  v_limit     INT;
  v_used      INT;
  v_remaining INT;
  v_to_debit  INT;
BEGIN
  SELECT tts_chars_limit, tts_chars_used
  INTO   v_limit, v_used
  FROM   public.profiles
  WHERE  id = p_user_id
  FOR UPDATE;

  -- 0 = service not available for this plan
  IF v_limit = 0 THEN
    RETURN 0;
  END IF;

  v_remaining := CASE
    WHEN v_limit = -1 THEN p_chars   -- unlimited
    ELSE GREATEST(v_limit - v_used, 0)
  END;

  v_to_debit := LEAST(v_remaining, p_chars);

  IF v_to_debit > 0 THEN
    UPDATE public.profiles
    SET    tts_chars_used = tts_chars_used + v_to_debit
    WHERE  id = p_user_id;
  END IF;

  RETURN v_to_debit;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ─── 5. RPC: debit_ai_usage ──────────────────────────────────────────────────
-- Atomically deduct one request from AI or Translate quota.
-- p_task: 'ai' | 'translate'
-- Returns 1 (debited) or 0 (quota exhausted / service not enabled).

DROP FUNCTION IF EXISTS public.debit_ai_usage(UUID, TEXT);

CREATE OR REPLACE FUNCTION public.debit_ai_usage(p_user_id UUID, p_task TEXT)
RETURNS INT AS $$
DECLARE
  v_limit INT;
  v_used  INT;
BEGIN
  IF p_task = 'ai' THEN
    SELECT ai_requests_limit, ai_requests_used
    INTO   v_limit, v_used
    FROM   public.profiles
    WHERE  id = p_user_id
    FOR UPDATE;

    IF v_limit = 0 THEN RETURN 0; END IF;

    IF v_limit != -1 AND v_used >= v_limit THEN
      RETURN 0;
    END IF;

    UPDATE public.profiles
    SET    ai_requests_used = ai_requests_used + 1
    WHERE  id = p_user_id;

  ELSIF p_task = 'translate' THEN
    SELECT translate_requests_limit, translate_requests_used
    INTO   v_limit, v_used
    FROM   public.profiles
    WHERE  id = p_user_id
    FOR UPDATE;

    IF v_limit = 0 THEN RETURN 0; END IF;

    IF v_limit != -1 AND v_used >= v_limit THEN
      RETURN 0;
    END IF;

    UPDATE public.profiles
    SET    translate_requests_used = translate_requests_used + 1
    WHERE  id = p_user_id;

  ELSE
    RETURN 0;
  END IF;

  RETURN 1;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ─── 6. Update sync_profile_plan_limit trigger ───────────────────────────────
-- Extend the existing trigger to also reset TTS/AI/Translate usage on plan change,
-- and sync the new limit columns from subscription_plans.

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

  -- Sync all limit columns from plan definition
  NEW.trial_limit_seconds       := v_plan.stt_seconds_limit;

  -- Reset all usage counters: fresh start on any plan change
  -- (upgrade: extra quota, downgrade: prevents negative balance)
  NEW.trial_seconds_used        := 0;
  NEW.tts_chars_used            := 0;
  NEW.ai_requests_used          := 0;
  NEW.translate_requests_used   := 0;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Trigger already exists from migration 005 — recreation picks up new function body.
DROP TRIGGER IF EXISTS trg_sync_plan_limit ON public.profiles;
CREATE TRIGGER trg_sync_plan_limit
  BEFORE UPDATE OF plan ON public.profiles
  FOR EACH ROW
  EXECUTE FUNCTION public.sync_profile_plan_limit();

-- ─── 7. Add cloud_service_config entries for tts + ai (example SQL) ──────────
-- Admin should run in SQL editor after setting Supabase Secrets.
-- Adjust provider_name and provider_config as needed.
--
-- INSERT INTO public.cloud_service_config (service_type, provider_name, provider_config, min_plan, is_active)
-- VALUES (
--   'tts', 'elevenlabs',
--   '{
--     "model": "eleven_flash_v2_5",
--     "voices": [
--       { "id": "auto",                  "label": "Auto",                  "is_default": true },
--       { "id": "QqID1ZB0DTItNxAKGBNW", "label": "Rachel (Female, EN)"                      },
--       { "id": "21m00Tcm4TlvDq8ikWAM", "label": "Adam (Male, EN)"                          }
--     ]
--   }',
--   'trial', true
-- );
--
-- INSERT INTO public.cloud_service_config (service_type, provider_name, provider_config, min_plan, is_active)
-- VALUES (
--   'ai', 'gemini',
--   '{ "model": "gemini-2.5-flash-preview-05-20" }',
--   'trial', true
-- );
