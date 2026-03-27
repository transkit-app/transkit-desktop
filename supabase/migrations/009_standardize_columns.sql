-- Migration: Standardize column naming + fix debit RPC bugs
--
-- Problems fixed:
--   1. trial_seconds_used / trial_limit_seconds break the plan_* naming convention
--      introduced in migration 008. Renamed for consistency:
--        trial_seconds_used  → stt_seconds_used
--        trial_limit_seconds → dropped (plan_stt_limit added in migration 008 is the canonical source)
--
--   2. debit_tts_usage (migration 006) reads `tts_chars_limit` from profiles —
--      that column does not exist. Correct column is `plan_tts_chars_limit` (migration 008).
--
--   3. debit_ai_usage (migration 006) reads `ai_requests_limit` /
--      `translate_requests_limit` from profiles — those columns do not exist.
--      Correct columns are `plan_ai_requests_limit` / `plan_translate_requests_limit`.
--
-- Column-level privilege note:
--   PostgreSQL tracks column privileges by OID, so REVOKE UPDATE follows a rename
--   automatically. After this migration, stt_seconds_used is still protected.
--   trial_limit_seconds is dropped so its privilege entry disappears naturally.

-- ─── 1. Rename trial_seconds_used → stt_seconds_used ─────────────────────────
ALTER TABLE public.profiles
  RENAME COLUMN trial_seconds_used TO stt_seconds_used;

-- ─── 2. Drop trial_limit_seconds (redundant with plan_stt_limit) ─────────────
--
-- Functions that referenced this column are recreated below before the DROP
-- so there are no dangling references at the time of drop.
-- The column is safe to remove: plan_stt_limit (migration 008) holds the same
-- value and is kept in sync by the trigger recreated in step 7.

-- ─── 3. Fix debit_trial_usage (STT pre-debit) ────────────────────────────────
DROP FUNCTION IF EXISTS public.debit_trial_usage(UUID, INT);

CREATE OR REPLACE FUNCTION public.debit_trial_usage(p_user_id UUID, p_seconds INT)
RETURNS INT AS $$
DECLARE
  v_remaining INT;
  v_to_debit  INT;
BEGIN
  SELECT
    CASE
      WHEN plan_stt_limit = -1 THEN p_seconds          -- unlimited plan
      ELSE GREATEST(plan_stt_limit - stt_seconds_used, 0)
    END
  INTO v_remaining
  FROM public.profiles
  WHERE id = p_user_id
  FOR UPDATE;

  v_to_debit := LEAST(v_remaining, p_seconds);

  IF v_to_debit > 0 THEN
    UPDATE public.profiles
    SET stt_seconds_used = stt_seconds_used + v_to_debit
    WHERE id = p_user_id;
  END IF;

  RETURN v_to_debit;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ─── 4. Fix reconcile_trial_usage (STT refund) ───────────────────────────────
CREATE OR REPLACE FUNCTION public.reconcile_trial_usage(p_user_id UUID, p_refund_seconds INT)
RETURNS VOID AS $$
  UPDATE public.profiles
  SET stt_seconds_used = GREATEST(stt_seconds_used - p_refund_seconds, 0)
  WHERE id = p_user_id;
$$ LANGUAGE SQL SECURITY DEFINER;

-- ─── 5. Fix debit_tts_usage: use plan_tts_chars_limit ────────────────────────
DROP FUNCTION IF EXISTS public.debit_tts_usage(UUID, INT);

CREATE OR REPLACE FUNCTION public.debit_tts_usage(p_user_id UUID, p_chars INT)
RETURNS INT AS $$
DECLARE
  v_limit     INT;
  v_used      INT;
  v_remaining INT;
  v_to_debit  INT;
BEGIN
  SELECT plan_tts_chars_limit, tts_chars_used
  INTO   v_limit, v_used
  FROM   public.profiles
  WHERE  id = p_user_id
  FOR UPDATE;

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
    SET tts_chars_used = tts_chars_used + v_to_debit
    WHERE id = p_user_id;
  END IF;

  RETURN v_to_debit;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ─── 6. Fix debit_ai_usage: use plan_ai_requests_limit / plan_translate_requests_limit ──
DROP FUNCTION IF EXISTS public.debit_ai_usage(UUID, TEXT);

CREATE OR REPLACE FUNCTION public.debit_ai_usage(p_user_id UUID, p_task TEXT)
RETURNS INT AS $$
DECLARE
  v_limit INT;
  v_used  INT;
BEGIN
  IF p_task = 'ai' THEN
    SELECT plan_ai_requests_limit, ai_requests_used
    INTO   v_limit, v_used
    FROM   public.profiles
    WHERE  id = p_user_id
    FOR UPDATE;

    IF v_limit = 0 THEN RETURN 0; END IF;
    IF v_limit != -1 AND v_used >= v_limit THEN RETURN 0; END IF;

    UPDATE public.profiles
    SET ai_requests_used = ai_requests_used + 1
    WHERE id = p_user_id;

  ELSIF p_task = 'translate' THEN
    SELECT plan_translate_requests_limit, translate_requests_used
    INTO   v_limit, v_used
    FROM   public.profiles
    WHERE  id = p_user_id
    FOR UPDATE;

    IF v_limit = 0 THEN RETURN 0; END IF;
    IF v_limit != -1 AND v_used >= v_limit THEN RETURN 0; END IF;

    UPDATE public.profiles
    SET translate_requests_used = translate_requests_used + 1
    WHERE id = p_user_id;

  ELSE
    RETURN 0;
  END IF;

  RETURN 1;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ─── 7. Update sync_profile_plan_limit trigger ────────────────────────────────
-- Remove reference to trial_limit_seconds; use stt_seconds_used and plan_stt_limit.
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

  -- Sync all denormalized limit columns
  NEW.plan_stt_limit                 := v_plan.stt_seconds_limit;
  NEW.plan_tts_chars_limit           := v_plan.tts_chars_limit;
  NEW.plan_ai_requests_limit         := v_plan.ai_requests_limit;
  NEW.plan_translate_requests_limit  := v_plan.translate_requests_limit;

  -- Reset all usage counters on any plan change
  NEW.stt_seconds_used        := 0;
  NEW.tts_chars_used          := 0;
  NEW.ai_requests_used        := 0;
  NEW.translate_requests_used := 0;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_sync_plan_limit ON public.profiles;
CREATE TRIGGER trg_sync_plan_limit
  BEFORE UPDATE OF plan ON public.profiles
  FOR EACH ROW
  EXECUTE FUNCTION public.sync_profile_plan_limit();

-- ─── 8. Now safe to drop trial_limit_seconds ─────────────────────────────────
ALTER TABLE public.profiles DROP COLUMN IF EXISTS trial_limit_seconds;
