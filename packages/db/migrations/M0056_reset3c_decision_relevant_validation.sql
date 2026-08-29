BEGIN;

-- RESET-3C V3: one compact permanent census plus one temporary, hash-bound
-- reconstruction payload per universe.  Existing M0053 V1/V2, M0054, and
-- shadow recommendations remain untouched.
CREATE TABLE IF NOT EXISTS research.reset3c_validation_universes(
  recommendation_id text PRIMARY KEY REFERENCES research.shadow_recommendations(recommendation_id),
  decision_id text NOT NULL,
  decision_at timestamptz NOT NULL,
  sampling_contract_version text NOT NULL CHECK(sampling_contract_version='reset3c-validation-sampling-v1'),
  storage_contract_version text NOT NULL CHECK(storage_contract_version='reset3c-universe-v3-decision-relevant'),
  capital_lamports numeric(30,0) NOT NULL CHECK(capital_lamports>0),
  expected_candidate_count integer NOT NULL CHECK(expected_candidate_count>=0),
  captured_candidate_count integer NOT NULL CHECK(captured_candidate_count>=0 AND captured_candidate_count<=expected_candidate_count),
  universe_complete boolean NOT NULL,
  universe_manifest_hash text NOT NULL CHECK(universe_manifest_hash ~ '^[0-9a-f]{64}$'),
  detailed_candidate_count integer NOT NULL CHECK(detailed_candidate_count>=0),
  outcome_eligible_candidate_count integer NOT NULL CHECK(outcome_eligible_candidate_count>=0 AND outcome_eligible_candidate_count<=detailed_candidate_count),
  expected_outcome_count integer NOT NULL CHECK(expected_outcome_count=outcome_eligible_candidate_count*3),
  detailed_candidate_ids jsonb NOT NULL,
  selection_manifest jsonb NOT NULL,
  detailed_selection_manifest_hash text NOT NULL CHECK(detailed_selection_manifest_hash ~ '^[0-9a-f]{64}$'),
  census jsonb NOT NULL,
  shared_evidence_hash text NOT NULL CHECK(shared_evidence_hash ~ '^[0-9a-f]{64}$'),
  temporary_shared_evidence jsonb,
  lifecycle_state text NOT NULL DEFAULT 'ACTIVE' CHECK(lifecycle_state IN ('ACTIVE','TERMINAL_ELIGIBLE','PURGED')),
  terminal_eligible_at timestamptz,
  purged_at timestamptz,
  content_hash text NOT NULL CHECK(content_hash ~ '^[0-9a-f]{64}$'),
  authority text NOT NULL CHECK(authority='RESEARCH_ONLY_NO_POLICY_MUTATION'),
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK(universe_complete OR captured_candidate_count<expected_candidate_count),
  CHECK((lifecycle_state='ACTIVE' AND temporary_shared_evidence IS NOT NULL AND terminal_eligible_at IS NULL AND purged_at IS NULL)
    OR (lifecycle_state='TERMINAL_ELIGIBLE' AND temporary_shared_evidence IS NOT NULL AND terminal_eligible_at IS NOT NULL AND purged_at IS NULL)
    OR (lifecycle_state='PURGED' AND temporary_shared_evidence IS NULL AND terminal_eligible_at IS NOT NULL AND purged_at IS NOT NULL))
);

CREATE INDEX IF NOT EXISTS reset3c_validation_universes_retention_idx
  ON research.reset3c_validation_universes(lifecycle_state,created_at,recommendation_id);

-- Purge is an UPDATE so PostgreSQL releases the old toasted payload for reuse
-- through autovacuum rather than immediately shrinking the filesystem.  Keep
-- this small, high-turnover table's TOAST cleanup prompt and bounded.
ALTER TABLE research.reset3c_validation_universes SET (
  autovacuum_vacuum_threshold=20,
  autovacuum_vacuum_scale_factor=0.02,
  toast.autovacuum_vacuum_threshold=20,
  toast.autovacuum_vacuum_scale_factor=0.02
);

CREATE OR REPLACE FUNCTION research.guard_reset3c_validation_universe_mutation() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP='DELETE' THEN
    RAISE EXCEPTION 'reset3c validation universe deletion is prohibited';
  END IF;
  IF OLD.recommendation_id IS DISTINCT FROM NEW.recommendation_id
    OR OLD.decision_id IS DISTINCT FROM NEW.decision_id
    OR OLD.decision_at IS DISTINCT FROM NEW.decision_at
    OR OLD.sampling_contract_version IS DISTINCT FROM NEW.sampling_contract_version
    OR OLD.storage_contract_version IS DISTINCT FROM NEW.storage_contract_version
    OR OLD.capital_lamports IS DISTINCT FROM NEW.capital_lamports
    OR OLD.expected_candidate_count IS DISTINCT FROM NEW.expected_candidate_count
    OR OLD.captured_candidate_count IS DISTINCT FROM NEW.captured_candidate_count
    OR OLD.universe_complete IS DISTINCT FROM NEW.universe_complete
    OR OLD.universe_manifest_hash IS DISTINCT FROM NEW.universe_manifest_hash
    OR OLD.detailed_candidate_count IS DISTINCT FROM NEW.detailed_candidate_count
    OR OLD.outcome_eligible_candidate_count IS DISTINCT FROM NEW.outcome_eligible_candidate_count
    OR OLD.expected_outcome_count IS DISTINCT FROM NEW.expected_outcome_count
    OR OLD.detailed_candidate_ids IS DISTINCT FROM NEW.detailed_candidate_ids
    OR OLD.selection_manifest IS DISTINCT FROM NEW.selection_manifest
    OR OLD.detailed_selection_manifest_hash IS DISTINCT FROM NEW.detailed_selection_manifest_hash
    OR OLD.census IS DISTINCT FROM NEW.census
    OR OLD.shared_evidence_hash IS DISTINCT FROM NEW.shared_evidence_hash
    OR OLD.content_hash IS DISTINCT FROM NEW.content_hash
    OR OLD.authority IS DISTINCT FROM NEW.authority
    OR OLD.created_at IS DISTINCT FROM NEW.created_at THEN
    RAISE EXCEPTION 'reset3c validation universe permanent evidence is immutable';
  END IF;
  IF OLD.lifecycle_state='ACTIVE' AND NEW.lifecycle_state='TERMINAL_ELIGIBLE'
    AND NEW.temporary_shared_evidence IS NOT NULL
    AND NEW.terminal_eligible_at IS NOT NULL
    AND NEW.purged_at IS NULL THEN
    RETURN NEW;
  END IF;
  IF OLD.lifecycle_state='TERMINAL_ELIGIBLE' AND NEW.lifecycle_state='PURGED'
    AND NEW.temporary_shared_evidence IS NULL
    AND NEW.terminal_eligible_at IS NOT NULL
    AND NEW.purged_at IS NOT NULL THEN
    RETURN NEW;
  END IF;
  RAISE EXCEPTION 'reset3c validation universe lifecycle mutation rejected';
END;
$$;

CREATE TRIGGER trg_reset3c_validation_universes_lifecycle_guard
  BEFORE UPDATE OR DELETE ON research.reset3c_validation_universes
  FOR EACH ROW EXECUTE FUNCTION research.guard_reset3c_validation_universe_mutation();

REVOKE DELETE ON research.reset3c_validation_universes FROM PUBLIC;

COMMIT;
