CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE EXTENSION IF NOT EXISTS vector;
CREATE TABLE IF NOT EXISTS profiles (
 user_id uuid PRIMARY KEY, preferences jsonb NOT NULL DEFAULT '{"leadHours":[72,24,1],"notifications":false}', created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS bank_items (
 id text PRIMARY KEY, user_id uuid NOT NULL REFERENCES profiles(user_id), encrypted_token jsonb NOT NULL,
 cursor text, import_status text NOT NULL DEFAULT 'importing', updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS bank_items_owner ON bank_items(user_id);
CREATE TABLE IF NOT EXISTS accounts (
 id text PRIMARY KEY, user_id uuid NOT NULL REFERENCES profiles(user_id), item_id text REFERENCES bank_items(id),
 name text NOT NULL, type text NOT NULL, mask text NOT NULL, balance bigint NOT NULL, currency text NOT NULL DEFAULT 'USD'
);
CREATE TABLE IF NOT EXISTS transactions (
 id text PRIMARY KEY, user_id uuid NOT NULL REFERENCES profiles(user_id), account_id text REFERENCES accounts(id),
 name text NOT NULL, amount bigint NOT NULL, date date NOT NULL, category text NOT NULL,
 pending boolean NOT NULL DEFAULT false, transfer boolean NOT NULL DEFAULT false, primary_category text,
 currency text NOT NULL DEFAULT 'USD', updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS transactions_owner_date ON transactions(user_id,date DESC);
CREATE TABLE IF NOT EXISTS budgets (
 user_id uuid NOT NULL REFERENCES profiles(user_id), category text NOT NULL, limit_cents bigint NOT NULL CHECK(limit_cents>=0), PRIMARY KEY(user_id,category)
);
CREATE TABLE IF NOT EXISTS bills (
 id text PRIMARY KEY, user_id uuid NOT NULL REFERENCES profiles(user_id), name text NOT NULL, amount bigint NOT NULL CHECK(amount>0), due date NOT NULL,
 category text NOT NULL DEFAULT 'Other', status text NOT NULL DEFAULT 'upcoming'
);
CREATE TABLE IF NOT EXISTS diary_entries (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid NOT NULL REFERENCES profiles(user_id),
 transcript text NOT NULL, tags text[] NOT NULL DEFAULT '{}', audio_key text, embedding vector(1536),
 transaction_ids text[] NOT NULL DEFAULT '{}', created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS diary_owner ON diary_entries(user_id,created_at DESC);
CREATE INDEX IF NOT EXISTS diary_vector ON diary_entries USING hnsw(embedding vector_cosine_ops);
CREATE TABLE IF NOT EXISTS dashboard_metrics (
 user_id uuid PRIMARY KEY REFERENCES profiles(user_id), data jsonb NOT NULL, checksum text NOT NULL, updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS push_subscriptions (
 id text PRIMARY KEY, user_id uuid NOT NULL REFERENCES profiles(user_id), subscription jsonb NOT NULL
);
CREATE TABLE IF NOT EXISTS notification_deliveries (
 id text PRIMARY KEY, user_id uuid NOT NULL REFERENCES profiles(user_id), sent_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS audit_log (
 id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY, user_id uuid, action text NOT NULL, resource text, request_id uuid, created_at timestamptz NOT NULL DEFAULT now()
);
-- Durable inbox: a broker outage cannot lose an acknowledged bank webhook.
CREATE TABLE IF NOT EXISTS webhook_inbox (
 id text PRIMARY KEY, item_id text NOT NULL, received_at timestamptz NOT NULL DEFAULT now(), processed_at timestamptz
);
-- RLS supports both Supabase JWT sessions and the API's transaction-local user scope.
CREATE OR REPLACE FUNCTION finsight_uid() RETURNS uuid LANGUAGE sql STABLE AS $$
 SELECT COALESCE(NULLIF(current_setting('app.user_id',true),''),NULLIF(current_setting('request.jwt.claim.sub',true),''),NULLIF(current_setting('request.jwt.claims',true),'')::jsonb->>'sub')::uuid
$$;
DO $$ DECLARE t text; BEGIN
 FOREACH t IN ARRAY ARRAY['profiles','accounts','transactions','budgets','bills','diary_entries','dashboard_metrics','push_subscriptions','notification_deliveries'] LOOP
  EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY',t);
  EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY',t);
  IF NOT EXISTS(SELECT 1 FROM pg_policies WHERE tablename=t AND policyname='owner_only') THEN
   EXECUTE format('CREATE POLICY owner_only ON %I USING (user_id = finsight_uid()) WITH CHECK (user_id = finsight_uid())',t);
  END IF;
 END LOOP;
END $$;
-- Credentials, inbox and audit are never exposed through Supabase's client API.
ALTER TABLE bank_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE webhook_inbox ENABLE ROW LEVEL SECURITY;
ALTER TABLE audit_log ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON bank_items,webhook_inbox,audit_log FROM PUBLIC;
DO $$ BEGIN
 IF NOT EXISTS(SELECT FROM pg_roles WHERE rolname='finsight_agent') THEN CREATE ROLE finsight_agent NOLOGIN; END IF;
END $$;
GRANT USAGE ON SCHEMA public TO finsight_agent;
GRANT SELECT ON transactions,accounts,budgets,bills,diary_entries TO finsight_agent;
GRANT SELECT,INSERT,UPDATE ON dashboard_metrics,budgets,bills TO finsight_agent;
-- Deliberately no banking writes, credentials, schema changes or audit deletion for agent.
DO $$ DECLARE r text; BEGIN
 FOREACH r IN ARRAY ARRAY['anon','authenticated'] LOOP
  IF EXISTS(SELECT FROM pg_roles WHERE rolname=r) THEN
   EXECUTE format('REVOKE ALL ON profiles,bank_items,accounts,transactions,budgets,bills,diary_entries,dashboard_metrics,push_subscriptions,notification_deliveries,audit_log,webhook_inbox FROM %I',r);
   IF r='authenticated' THEN GRANT SELECT ON accounts,transactions,budgets,bills,diary_entries,dashboard_metrics TO authenticated; END IF;
  END IF;
 END LOOP;
END $$;
