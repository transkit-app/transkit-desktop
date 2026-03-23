-- Migration: Pre-debit usage model
-- Run in: Supabase Dashboard → SQL Editor

-- Add debited_seconds column to usage_sessions
ALTER TABLE usage_sessions ADD COLUMN IF NOT EXISTS debited_seconds INT NOT NULL DEFAULT 0;

-- Atomic debit at session start
CREATE OR REPLACE FUNCTION public.debit_trial_usage(p_user_id UUID, p_seconds INT)
RETURNS VOID AS $$
  UPDATE public.profiles
  SET trial_seconds_used = LEAST(trial_seconds_used + p_seconds, trial_limit_seconds)
  WHERE id = p_user_id;
$$ LANGUAGE SQL SECURITY DEFINER;

-- Atomic refund at session stop
CREATE OR REPLACE FUNCTION public.reconcile_trial_usage(p_user_id UUID, p_refund_seconds INT)
RETURNS VOID AS $$
  UPDATE public.profiles
  SET trial_seconds_used = GREATEST(trial_seconds_used - p_refund_seconds, 0)
  WHERE id = p_user_id;
$$ LANGUAGE SQL SECURITY DEFINER;
