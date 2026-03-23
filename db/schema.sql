-- ─────────────────────────────────────────────────────────────────────────────
-- Transkit Auth & Usage Schema
-- Run this in: Supabase Dashboard → SQL Editor
-- ─────────────────────────────────────────────────────────────────────────────

-- Profiles: created automatically on user signup
CREATE TABLE IF NOT EXISTS profiles (
  id                    UUID PRIMARY KEY REFERENCES auth.users ON DELETE CASCADE,
  email                 TEXT,
  avatar_url            TEXT,
  trial_seconds_used    INT NOT NULL DEFAULT 0,
  trial_limit_seconds   INT NOT NULL DEFAULT 600, -- 10 minutes trial
  created_at            TIMESTAMPTZ DEFAULT now()
);

-- Usage sessions: one row per Monitor session
CREATE TABLE IF NOT EXISTS usage_sessions (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id               UUID NOT NULL REFERENCES profiles ON DELETE CASCADE,
  started_at            TIMESTAMPTZ DEFAULT now(),
  duration_seconds      INT NOT NULL DEFAULT 0,
  soniox_reference_id   TEXT -- "{user_id}:{session_id}" sent to Soniox for audit
);

-- Row Level Security
ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE usage_sessions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own profile"
  ON profiles FOR SELECT USING (auth.uid() = id);

CREATE POLICY "Users can update own profile"
  ON profiles FOR UPDATE USING (auth.uid() = id);

CREATE POLICY "Users can view own sessions"
  ON usage_sessions FOR SELECT USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own sessions"
  ON usage_sessions FOR INSERT WITH CHECK (auth.uid() = user_id);

-- Auto-create profile on signup
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO public.profiles (id, email, avatar_url)
  VALUES (
    NEW.id,
    NEW.email,
    NEW.raw_user_meta_data ->> 'avatar_url'
  )
  ON CONFLICT (id) DO NOTHING;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- Atomic usage increment (prevents race conditions)
CREATE OR REPLACE FUNCTION public.increment_trial_usage(p_user_id UUID, p_seconds INT)
RETURNS VOID AS $$
  UPDATE public.profiles
  SET trial_seconds_used = LEAST(trial_seconds_used + p_seconds, trial_limit_seconds)
  WHERE id = p_user_id;
$$ LANGUAGE SQL SECURITY DEFINER;
