BEGIN;
CREATE TABLE IF NOT EXISTS governance.evidence_events(id bigserial PRIMARY KEY,work_item text NOT NULL,event_type text NOT NULL,details jsonb NOT NULL DEFAULT '{}'::jsonb,created_at timestamptz NOT NULL DEFAULT now());
CREATE OR REPLACE FUNCTION governance.reject_update_delete_schema_migrations() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'schema_migrations is append-only'; END $$;
DROP TRIGGER IF EXISTS trg_schema_migrations_append_only ON governance.schema_migrations;
CREATE TRIGGER trg_schema_migrations_append_only BEFORE UPDATE OR DELETE ON governance.schema_migrations FOR EACH ROW EXECUTE FUNCTION governance.reject_update_delete_schema_migrations();
COMMIT;
