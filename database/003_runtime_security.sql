-- Runtime identities are members of these NOLOGIN groups; migration credentials stay separate.
DO $$ BEGIN
 IF NOT EXISTS(SELECT FROM pg_roles WHERE rolname='finsight_api') THEN CREATE ROLE finsight_api NOLOGIN; END IF;
 IF NOT EXISTS(SELECT FROM pg_roles WHERE rolname='finsight_worker') THEN CREATE ROLE finsight_worker NOLOGIN; END IF;
END $$;
REVOKE CREATE ON SCHEMA public FROM PUBLIC;
GRANT USAGE ON SCHEMA public TO finsight_api,finsight_worker;
GRANT SELECT,INSERT,UPDATE,DELETE ON profiles,accounts,transactions,budgets,bills,diary_entries,dashboard_metrics,push_subscriptions,notification_deliveries TO finsight_api,finsight_worker;
-- API imports statements; only the worker decrypts and reads Plaid credentials.
GRANT INSERT,UPDATE ON bank_items TO finsight_api;
GRANT SELECT(id,user_id,import_status) ON bank_items TO finsight_api;
GRANT SELECT,INSERT,UPDATE,DELETE ON bank_items TO finsight_worker;
DROP POLICY IF EXISTS api_items ON bank_items;
CREATE POLICY api_items ON bank_items TO finsight_api USING(user_id=finsight_uid()) WITH CHECK(user_id=finsight_uid());
DROP POLICY IF EXISTS worker_items ON bank_items;
CREATE POLICY worker_items ON bank_items TO finsight_worker USING(true) WITH CHECK(true);
ALTER TABLE bank_items FORCE ROW LEVEL SECURITY;
GRANT INSERT ON webhook_inbox TO finsight_api;
GRANT SELECT,INSERT,UPDATE ON webhook_inbox TO finsight_worker;
DROP POLICY IF EXISTS api_inbox ON webhook_inbox;
CREATE POLICY api_inbox ON webhook_inbox FOR INSERT TO finsight_api WITH CHECK(true);
DROP POLICY IF EXISTS worker_inbox ON webhook_inbox;
CREATE POLICY worker_inbox ON webhook_inbox TO finsight_worker USING(true) WITH CHECK(true);
ALTER TABLE webhook_inbox FORCE ROW LEVEL SECURITY;
GRANT INSERT ON audit_log TO finsight_api,finsight_worker;
GRANT SELECT ON audit_log TO finsight_worker;
GRANT USAGE ON SEQUENCE audit_log_id_seq TO finsight_api,finsight_worker;
DROP POLICY IF EXISTS runtime_audit_insert ON audit_log;
CREATE POLICY runtime_audit_insert ON audit_log FOR INSERT TO finsight_api,finsight_worker WITH CHECK(true);
DROP POLICY IF EXISTS worker_audit_read ON audit_log;
CREATE POLICY worker_audit_read ON audit_log FOR SELECT TO finsight_worker USING(true);
ALTER TABLE audit_log FORCE ROW LEVEL SECURITY;
GRANT INSERT,SELECT ON statement_imports TO finsight_api;
DROP POLICY IF EXISTS api_statements ON statement_imports;
CREATE POLICY api_statements ON statement_imports TO finsight_api USING(user_id=finsight_uid()) WITH CHECK(user_id=finsight_uid());
ALTER TABLE statement_imports FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS worker_profile_list ON profiles;
CREATE POLICY worker_profile_list ON profiles FOR SELECT TO finsight_worker USING(true);
CREATE TABLE IF NOT EXISTS audit_exports (audit_id bigint PRIMARY KEY REFERENCES audit_log(id), exported_at timestamptz NOT NULL DEFAULT now());
ALTER TABLE audit_exports ENABLE ROW LEVEL SECURITY;
ALTER TABLE audit_exports FORCE ROW LEVEL SECURITY;
REVOKE ALL ON audit_exports FROM PUBLIC;
GRANT SELECT,INSERT ON audit_exports TO finsight_worker;
DROP POLICY IF EXISTS worker_audit_exports ON audit_exports;
CREATE POLICY worker_audit_exports ON audit_exports TO finsight_worker USING(true) WITH CHECK(true);
DO $$ DECLARE r text; BEGIN
 FOREACH r IN ARRAY ARRAY['anon','authenticated'] LOOP
  IF EXISTS(SELECT FROM pg_roles WHERE rolname=r) THEN
   EXECUTE format('REVOKE ALL ON statement_imports,audit_exports FROM %I',r);
  END IF;
 END LOOP;
END $$;
