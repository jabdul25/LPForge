BEGIN;
CREATE TABLE IF NOT EXISTS research.candidate_universe_rerank_retention(
 recommendation_id text PRIMARY KEY REFERENCES research.shadow_recommendations(recommendation_id),
 decision_id text NOT NULL, decision_at timestamptz NOT NULL, pool_address text NOT NULL, calibration_version text NOT NULL,
 expected_candidate_count integer NOT NULL CHECK(expected_candidate_count>=0), persisted_candidate_count integer NOT NULL CHECK(persisted_candidate_count=expected_candidate_count),
 universe_manifest_hash text NOT NULL CHECK(universe_manifest_hash ~ '^[0-9a-f]{64}$'), candidate_facts jsonb, compact_summary jsonb NOT NULL, retention_until timestamptz NOT NULL,
 lifecycle_state text NOT NULL DEFAULT 'ACTIVE' CHECK(lifecycle_state IN ('ACTIVE','COMPACTED')), compacted_at timestamptz, content_hash text NOT NULL CHECK(content_hash ~ '^[0-9a-f]{64}$'), created_at timestamptz NOT NULL DEFAULT now(),
 CHECK(jsonb_typeof(candidate_facts)='object'), CHECK(jsonb_array_length(candidate_facts->'candidates')=expected_candidate_count), CHECK(jsonb_array_length(candidate_facts->'simulations')=expected_candidate_count), CHECK(jsonb_array_length(candidate_facts->'rankings')=expected_candidate_count),
 CHECK((lifecycle_state='ACTIVE' AND candidate_facts IS NOT NULL AND compacted_at IS NULL) OR (lifecycle_state='COMPACTED' AND candidate_facts IS NULL AND compacted_at IS NOT NULL))
);
CREATE INDEX candidate_universe_rerank_retention_cohort_idx ON research.candidate_universe_rerank_retention(calibration_version,decision_at,recommendation_id) WHERE lifecycle_state='ACTIVE';
CREATE INDEX candidate_universe_rerank_retention_purge_idx ON research.candidate_universe_rerank_retention(lifecycle_state,retention_until,recommendation_id);
CREATE OR REPLACE FUNCTION research.guard_candidate_universe_rerank_retention() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_OP='DELETE' THEN RAISE EXCEPTION 'candidate universe rerank retention deletion is prohibited'; END IF;
 IF OLD.recommendation_id IS DISTINCT FROM NEW.recommendation_id OR OLD.decision_id IS DISTINCT FROM NEW.decision_id OR OLD.decision_at IS DISTINCT FROM NEW.decision_at OR OLD.pool_address IS DISTINCT FROM NEW.pool_address OR OLD.calibration_version IS DISTINCT FROM NEW.calibration_version OR OLD.expected_candidate_count IS DISTINCT FROM NEW.expected_candidate_count OR OLD.persisted_candidate_count IS DISTINCT FROM NEW.persisted_candidate_count OR OLD.universe_manifest_hash IS DISTINCT FROM NEW.universe_manifest_hash OR OLD.compact_summary IS DISTINCT FROM NEW.compact_summary OR OLD.retention_until IS DISTINCT FROM NEW.retention_until OR OLD.content_hash IS DISTINCT FROM NEW.content_hash OR OLD.created_at IS DISTINCT FROM NEW.created_at THEN RAISE EXCEPTION 'candidate universe rerank permanent evidence is immutable'; END IF;
 IF OLD.lifecycle_state='ACTIVE' AND NEW.lifecycle_state='COMPACTED' AND NEW.candidate_facts IS NULL AND NEW.compacted_at IS NOT NULL THEN RETURN NEW; END IF;
 RAISE EXCEPTION 'candidate universe rerank lifecycle mutation rejected';
END; $$;
CREATE TRIGGER trg_candidate_universe_rerank_retention_guard BEFORE UPDATE OR DELETE ON research.candidate_universe_rerank_retention FOR EACH ROW EXECUTE FUNCTION research.guard_candidate_universe_rerank_retention();
REVOKE DELETE ON research.candidate_universe_rerank_retention FROM PUBLIC;
COMMIT;
