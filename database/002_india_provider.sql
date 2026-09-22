-- Adds a provider dimension so accounts/transactions can come from Plaid, the India
-- Account Aggregator sandbox, or an ICICI statement import without changing existing
-- Plaid rows: every new column defaults to a value that reproduces current behavior.
ALTER TABLE bank_items ADD COLUMN IF NOT EXISTS provider text NOT NULL DEFAULT 'plaid';
ALTER TABLE accounts ADD COLUMN IF NOT EXISTS provider text NOT NULL DEFAULT 'plaid';
ALTER TABLE accounts ADD COLUMN IF NOT EXISTS subtype text;
ALTER TABLE accounts ADD COLUMN IF NOT EXISTS available_balance bigint;
ALTER TABLE transactions ADD COLUMN IF NOT EXISTS provider text NOT NULL DEFAULT 'plaid';
ALTER TABLE transactions ADD COLUMN IF NOT EXISTS merchant text;
ALTER TABLE transactions ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'posted';
ALTER TABLE transactions ADD COLUMN IF NOT EXISTS reference text;
-- accounts.item_id was already nullable in 001_schema.sql; statement-imported accounts have no bank_items row.

-- Tracks statement imports (e.g. ICICI CSV) for audit and re-upload idempotency; holds
-- no file contents, only counts and a hash of the source bytes.
CREATE TABLE IF NOT EXISTS statement_imports (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid NOT NULL REFERENCES profiles(user_id),
 account_id text NOT NULL REFERENCES accounts(id), provider text NOT NULL,
 source_hash text NOT NULL, row_count integer NOT NULL DEFAULT 0, skipped_count integer NOT NULL DEFAULT 0,
 imported_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS statement_imports_owner ON statement_imports(user_id, imported_at DESC);
-- Like bank_items/webhook_inbox/audit_log: backend-only, never exposed through Supabase's
-- client API, and written via a plain pool.query (not scoped()) — so no FORCE here, matching
-- those tables, since FORCE would also bind the app's own owning role to app.user_id.
ALTER TABLE statement_imports ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON statement_imports FROM PUBLIC;
