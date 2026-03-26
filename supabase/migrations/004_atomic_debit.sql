-- Migration: Atomic debit with row-level lock
--
-- Problem with the old debit_trial_usage:
--   The edge function reads `remaining` in application code, then calls the RPC.
--   Two concurrent requests can both pass the `remaining > 0` check and both
--   call the RPC — resulting in two sessions being created from the same quota
--   window, with only one of them actually debiting quota (LEAST cap is correct
--   but the second session still receives valid provider credentials for free).
--
-- Fix: rewrite debit_trial_usage in PL/pgSQL with FOR UPDATE to lock the
--   profile row for the duration of the transaction. The function now returns
--   the actual seconds debited (0 means quota was already exhausted).
--   Edge functions check the return value and abort with quota_exceeded if 0.
--
-- reconcile_trial_usage is unchanged (simple UPDATE, no lock needed).

-- DROP required because we are changing the return type from VOID to INT.
-- PostgreSQL does not allow CREATE OR REPLACE to change a function's return type.
DROP FUNCTION IF EXISTS public.debit_trial_usage(UUID, INT);

CREATE OR REPLACE FUNCTION public.debit_trial_usage(p_user_id UUID, p_seconds INT)
RETURNS INT AS $$
DECLARE
  v_remaining INT;
  v_to_debit  INT;
BEGIN
  -- Lock the profile row for this transaction — concurrent calls will queue
  -- here and see the already-updated trial_seconds_used after the lock releases.
  SELECT GREATEST(trial_limit_seconds - trial_seconds_used, 0)
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

  -- Returns 0 if quota was already exhausted; caller must treat 0 as quota_exceeded.
  RETURN v_to_debit;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
