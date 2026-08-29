BEGIN;

-- RESET-3C compact M0053 rows resolve their decision-wide frames/events from
-- this existing per-recommendation snapshot.  The snapshot was already
-- append-only by writer behavior; make that invariant database-enforced
-- before it becomes a hash-bound shared-evidence reference.
CREATE OR REPLACE FUNCTION research.reject_shadow_recommendation_mutation() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'shadow recommendation evidence is append-only';
END;
$$;

DROP TRIGGER IF EXISTS trg_shadow_recommendations_immutable ON research.shadow_recommendations;
CREATE TRIGGER trg_shadow_recommendations_immutable
  BEFORE UPDATE OR DELETE ON research.shadow_recommendations
  FOR EACH ROW EXECUTE FUNCTION research.reject_shadow_recommendation_mutation();

REVOKE UPDATE, DELETE ON research.shadow_recommendations FROM PUBLIC;

COMMIT;
