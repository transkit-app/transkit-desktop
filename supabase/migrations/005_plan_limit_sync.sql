-- Migration: Sync trial_limit_seconds from subscription_plans
--
-- Root cause: trial_limit_seconds in profiles is a denormalized cache set at
-- account creation time. When an admin upgrades profiles.plan, trial_limit_seconds
-- was not updated — causing the wrong quota to be enforced and displayed.
--
-- Fixes:
--   1. BEFORE UPDATE trigger: auto-sync trial_limit_seconds whenever plan changes.
--   2. Backfill: fix all existing rows where trial_limit_seconds != plan's limit.
--   3. debit_trial_usage: handle -1 (unlimited) correctly (Pro plan).
--   4. get-cloud-credentials edge function: already reads trial_limit_seconds,
--      now correct after this migration; also handles -1 inline.

-- ─── 1. Trigger function ─────────────────────────────────────────────────────
-- BEFORE UPDATE OF plan: sets NEW.trial_limit_seconds from subscription_plans
-- before the row is written. No additional UPDATE needed — no infinite loop risk.

CREATE OR REPLACE FUNCTION public.sync_profile_plan_limit()
RETURNS TRIGGER AS $$
BEGIN
  -- Sync the STT limit from subscription_plans
  NEW.trial_limit_seconds := (
    SELECT stt_seconds_limit
    FROM public.subscription_plans
    WHERE name = NEW.plan
  );
  -- Reset usage counter: minutes used under the old plan do not carry over.
  -- e.g. used 4/5 min on Trial → upgrade to Starter → 0/3000 min fresh start.
  NEW.trial_seconds_used := 0;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_sync_plan_limit ON public.profiles;
CREATE TRIGGER trg_sync_plan_limit
  BEFORE UPDATE OF plan ON public.profiles
  FOR EACH ROW
  EXECUTE FUNCTION public.sync_profile_plan_limit();

-- ─── 2. Backfill existing rows ───────────────────────────────────────────────
-- Fix all profiles whose trial_limit_seconds doesn't match their current plan.
-- Does NOT reset trial_seconds_used here — existing usage history is kept as-is;
-- only future plan changes will trigger the reset going forward.

UPDATE public.profiles p
SET trial_limit_seconds = sp.stt_seconds_limit
FROM public.subscription_plans sp
WHERE p.plan = sp.name
  AND p.trial_limit_seconds IS DISTINCT FROM sp.stt_seconds_limit;

-- ─── 3. Rewrite debit_trial_usage to handle -1 (unlimited) ──────────────────
-- Old version: GREATEST(trial_limit_seconds - trial_seconds_used, 0)
--   When trial_limit_seconds = -1: GREATEST(-1 - used, 0) = 0 → quota_exceeded!
-- New version: -1 short-circuits to always grant full p_seconds.

DROP FUNCTION IF EXISTS public.debit_trial_usage(UUID, INT);

CREATE OR REPLACE FUNCTION public.debit_trial_usage(p_user_id UUID, p_seconds INT)
RETURNS INT AS $$
DECLARE
  v_remaining INT;
  v_to_debit  INT;
BEGIN
  -- Lock the profile row; concurrent calls queue here and see the updated
  -- trial_seconds_used after the lock releases, preventing double-spend.
  SELECT
    CASE
      WHEN trial_limit_seconds = -1 THEN p_seconds          -- unlimited plan
      ELSE GREATEST(trial_limit_seconds - trial_seconds_used, 0)
    END
  INTO v_remaining
  FROM public.profiles
  WHERE id = p_user_id
  FOR UPDATE;

  v_to_debit := LEAST(v_remaining, p_seconds);

  IF v_to_debit > 0 THEN
    UPDATE public.profiles
    SET trial_seconds_used = trial_seconds_used + v_to_debit
    WHERE id = p_user_id;
  END IF;

  -- Returns 0 if quota exhausted; caller treats 0 as quota_exceeded.
  RETURN v_to_debit;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
