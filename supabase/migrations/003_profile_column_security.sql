-- Migration: Column-level security on profiles
-- Prevents authenticated users from directly updating quota/billing fields,
-- even if they bypass the frontend and craft raw Supabase API calls.
--
-- Background: Supabase RLS is row-level only — it cannot restrict which columns
-- a policy allows to be written. An UPDATE policy with `id = auth.uid()` lets
-- the user update ANY column in their own row, including trial_seconds_used.
--
-- PostgreSQL column-level privileges are enforced BEFORE RLS and cannot be
-- overridden by RLS policies or application code using the `authenticated` role.
-- The `service_role` used by edge functions bypasses both RLS and column
-- privileges, so the debit/reconcile RPCs continue to work normally.

-- Revoke direct UPDATE on sensitive columns from authenticated users.
-- Users can still read these columns (SELECT is not affected).
REVOKE UPDATE (
  trial_seconds_used,
  trial_limit_seconds,
  plan
) ON public.profiles FROM authenticated;

-- Sanity-check: authenticated users may still UPDATE safe profile fields
-- (full_name, role, company, experience_level, expertise, notes, avatar_url).
-- Those columns retain their existing UPDATE privilege.
