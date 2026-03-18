-- Run this in Supabase SQL Editor

CREATE TABLE users (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email text UNIQUE NOT NULL,
  created_at timestamptz DEFAULT now(),
  referral_code text UNIQUE NOT NULL,
  referred_by_user_id uuid REFERENCES users(id) ON DELETE SET NULL
);

CREATE TABLE subscriptions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid UNIQUE REFERENCES users(id) ON DELETE CASCADE,
  plan text NOT NULL DEFAULT 'free',
  status text NOT NULL DEFAULT 'active',
  expires_at timestamptz,
  extra_minutes_per_month int DEFAULT 0,
  addon_expires_at timestamptz,
  bonus_minutes int DEFAULT 0,
  stripe_customer_id text,
  stripe_subscription_id text,
  is_early_adopter boolean DEFAULT false,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

CREATE TABLE whatsapp_sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid UNIQUE REFERENCES users(id) ON DELETE CASCADE,
  credentials_json text NOT NULL,
  phone_number text NOT NULL,
  status text NOT NULL DEFAULT 'pending',
  last_connected_at timestamptz
);

CREATE TABLE transcriptions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid REFERENCES users(id) ON DELETE CASCADE,
  sender_name text,
  sender_jid text,
  audio_duration_sec int,
  transcript text,
  summary text,
  language_ok boolean DEFAULT true,
  visible boolean DEFAULT true,
  created_at timestamptz DEFAULT now()
);

CREATE INDEX idx_transcriptions_user_created
  ON transcriptions(user_id, created_at DESC);

CREATE TABLE usage (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid REFERENCES users(id) ON DELETE CASCADE,
  month text NOT NULL,
  minutes_used int DEFAULT 0,
  quota_exceeded_at timestamptz,
  UNIQUE(user_id, month)
);

CREATE TABLE push_tokens (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid REFERENCES users(id) ON DELETE CASCADE,
  expo_push_token text NOT NULL,
  platform text NOT NULL,
  updated_at timestamptz DEFAULT now(),
  UNIQUE(user_id, platform)
);

CREATE TABLE referrals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  referrer_user_id uuid REFERENCES users(id) ON DELETE SET NULL,
  referred_user_id uuid UNIQUE REFERENCES users(id) ON DELETE CASCADE,
  bonus_applied_at timestamptz
);

CREATE TABLE pending_transcriptions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid REFERENCES users(id) ON DELETE CASCADE,
  message_data jsonb NOT NULL,
  audio_data bytea,
  status text NOT NULL DEFAULT 'pending',
  attempts int DEFAULT 0,
  last_error text,
  next_retry_at timestamptz,
  created_at timestamptz DEFAULT now()
);

CREATE TABLE user_settings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid UNIQUE REFERENCES users(id) ON DELETE CASCADE,
  preferred_languages text[] DEFAULT '{en}',
  notifications_enabled boolean DEFAULT true,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

ALTER TABLE users ENABLE ROW LEVEL SECURITY;
ALTER TABLE subscriptions ENABLE ROW LEVEL SECURITY;
ALTER TABLE whatsapp_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE transcriptions ENABLE ROW LEVEL SECURITY;
ALTER TABLE usage ENABLE ROW LEVEL SECURITY;
ALTER TABLE push_tokens ENABLE ROW LEVEL SECURITY;
ALTER TABLE referrals ENABLE ROW LEVEL SECURITY;
ALTER TABLE pending_transcriptions ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_settings ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users read own data" ON users
  FOR SELECT USING (auth.uid() = id);

CREATE POLICY "Users read own subscriptions" ON subscriptions
  FOR SELECT USING (auth.uid() = user_id);

CREATE POLICY "Users read own transcriptions" ON transcriptions
  FOR SELECT USING (auth.uid() = user_id);

CREATE POLICY "Users read own usage" ON usage
  FOR SELECT USING (auth.uid() = user_id);

CREATE POLICY "Users read own settings" ON user_settings
  FOR SELECT USING (auth.uid() = user_id);

CREATE POLICY "Users update own settings" ON user_settings
  FOR UPDATE USING (auth.uid() = user_id);
