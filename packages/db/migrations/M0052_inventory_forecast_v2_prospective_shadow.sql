BEGIN;

-- M0052 adds a separate prospective, shadow-only inventory forecast.  It
-- neither rewrites inventory-forecast-v1 nor alters any decision/outcome row.
CREATE TABLE IF NOT EXISTS research.inventory_forecast_v2_activation(
  activation_id text PRIMARY KEY,
  activated_at timestamptz NOT NULL,
  source_sha text NOT NULL,
  build_id text NOT NULL,
  migration_head text NOT NULL,
  policy_hash text NOT NULL,
  forecast_schema_version text NOT NULL,
  forecast_model_version text NOT NULL,
  formula_version text NOT NULL,
  collector_version text NOT NULL,
  m0050_market_context_model_version text NOT NULL,
  v2_outcome_model_version text NOT NULL,
  authority text NOT NULL CHECK(authority='RESEARCH_ONLY_NO_POLICY_MUTATION'),
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK(source_sha ~ '^[0-9a-f]{40}$'),
  CHECK(build_id ~ '^[0-9a-f]{64}$'),
  CHECK(policy_hash ~ '^[0-9a-f]{64}$'),
  CHECK(migration_head ~ '^M[0-9]{4}_.+[.]sql$'),
  CHECK(forecast_model_version='inventory-forecast-v2-shadow-v1'),
  CHECK(formula_version='capital-constrained-analogue-scenarios-v1')
);

CREATE TABLE IF NOT EXISTS research.inventory_forecast_v2_predictions(
  inventory_forecast_prediction_id text PRIMARY KEY,
  telemetry_episode_id text NOT NULL REFERENCES research.post_entry_telemetry_episodes(telemetry_episode_id),
  recommendation_id text NOT NULL,
  candidate_id text NOT NULL,
  pool_address text NOT NULL REFERENCES protocol.pools(address),
  decision_at timestamptz NOT NULL,
  captured_at timestamptz NOT NULL,
  decision_source_sha text NOT NULL,
  decision_build_id text NOT NULL,
  decision_migration_head text NOT NULL,
  forecast_schema_version text NOT NULL,
  forecast_model_version text NOT NULL,
  formula_version text NOT NULL,
  collector_version text NOT NULL,
  capture_status text NOT NULL CHECK(capture_status IN ('OBSERVED','FORECAST_UNAVAILABLE','SOURCE_UNAVAILABLE','SOURCE_STALE','SOURCE_TIMESTAMP_UNVERIFIED','DUPLICATE_REJECTED','INTEGRITY_CONFLICT','PRE_ACTIVATION_NOT_APPLICABLE')),
  reason_codes jsonb NOT NULL DEFAULT '[]'::jsonb,
  raw_frozen_inputs jsonb NOT NULL,
  derived_forecast jsonb NOT NULL,
  provenance jsonb NOT NULL,
  content_hash text NOT NULL,
  authority text NOT NULL CHECK(authority='RESEARCH_ONLY_NO_POLICY_MUTATION'),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(telemetry_episode_id,candidate_id,forecast_model_version),
  UNIQUE(recommendation_id,candidate_id,forecast_model_version),
  CHECK(decision_source_sha ~ '^[0-9a-f]{40}$'),
  CHECK(decision_build_id ~ '^[0-9a-f]{64}$'),
  CHECK(decision_migration_head ~ '^M[0-9]{4}_.+[.]sql$'),
  CHECK(content_hash ~ '^[0-9a-f]{64}$')
);

CREATE INDEX IF NOT EXISTS inventory_forecast_v2_predictions_pool_time_idx
  ON research.inventory_forecast_v2_predictions(pool_address,decision_at ASC);
CREATE INDEX IF NOT EXISTS inventory_forecast_v2_predictions_status_idx
  ON research.inventory_forecast_v2_predictions(capture_status,decision_at ASC);
CREATE INDEX IF NOT EXISTS inventory_forecast_v2_predictions_recommendation_idx
  ON research.inventory_forecast_v2_predictions(recommendation_id,forecast_model_version);

-- A one-entry manifest is anchored to the immutable M0049 episode header.
CREATE TABLE IF NOT EXISTS research.inventory_forecast_v2_manifest(
  inventory_forecast_prediction_id text PRIMARY KEY REFERENCES research.inventory_forecast_v2_predictions(inventory_forecast_prediction_id),
  telemetry_episode_id text NOT NULL REFERENCES research.post_entry_telemetry_episodes(telemetry_episode_id),
  observed_at timestamptz NOT NULL,
  captured_at timestamptz NOT NULL,
  source_version text NOT NULL,
  collector_version text NOT NULL,
  forecast_model_version text NOT NULL,
  content_hash text NOT NULL,
  previous_hash text NOT NULL,
  current_hash text NOT NULL,
  capture_status text NOT NULL CHECK(capture_status IN ('OBSERVED','FORECAST_UNAVAILABLE','SOURCE_UNAVAILABLE','SOURCE_STALE','SOURCE_TIMESTAMP_UNVERIFIED','DUPLICATE_REJECTED','INTEGRITY_CONFLICT','PRE_ACTIVATION_NOT_APPLICABLE')),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(telemetry_episode_id,forecast_model_version),
  CHECK(content_hash ~ '^[0-9a-f]{64}$'),
  CHECK(previous_hash ~ '^[0-9a-f]{64}$'),
  CHECK(current_hash ~ '^[0-9a-f]{64}$')
);

CREATE TABLE IF NOT EXISTS research.inventory_forecast_v2_capture_audit(
  audit_id bigserial PRIMARY KEY,
  telemetry_episode_id text NOT NULL REFERENCES research.post_entry_telemetry_episodes(telemetry_episode_id),
  candidate_id text NOT NULL,
  forecast_model_version text NOT NULL,
  attempted_at timestamptz NOT NULL,
  capture_status text NOT NULL CHECK(capture_status IN ('ACTIVATED','INSERTED','DUPLICATE_REJECTED','INTEGRITY_CONFLICT')),
  attempted_content_hash text,
  detail jsonb NOT NULL DEFAULT '{}'::jsonb,
  authority text NOT NULL CHECK(authority='RESEARCH_ONLY_NO_POLICY_MUTATION'),
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK(attempted_content_hash IS NULL OR attempted_content_hash ~ '^[0-9a-f]{64}$')
);

CREATE INDEX IF NOT EXISTS inventory_forecast_v2_capture_audit_episode_idx
  ON research.inventory_forecast_v2_capture_audit(telemetry_episode_id,attempted_at ASC);

-- Pre-activation M0049 episodes remain truthfully not applicable.  This view
-- does not mutate historical evidence and is read-only research metadata.
CREATE OR REPLACE VIEW research.inventory_forecast_v2_episode_status AS
SELECT e.telemetry_episode_id,e.recommendation_id,e.pool_address,e.decision_at,
  CASE
    WHEN a.activated_at IS NULL OR e.decision_at<a.activated_at THEN 'PRE_ACTIVATION_NOT_APPLICABLE'
    WHEN p.inventory_forecast_prediction_id IS NULL THEN 'PENDING_PROSPECTIVE_CAPTURE'
    ELSE p.capture_status
  END AS inventory_forecast_v2_capture_status
FROM research.post_entry_telemetry_episodes e
LEFT JOIN research.inventory_forecast_v2_activation a
  ON a.activation_id='inventory-forecast-v2-shadow-v1'
LEFT JOIN research.inventory_forecast_v2_predictions p
  ON p.telemetry_episode_id=e.telemetry_episode_id
 AND p.forecast_model_version='inventory-forecast-v2-shadow-v1';

CREATE OR REPLACE FUNCTION research.reject_inventory_forecast_v2_mutation() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'inventory forecast v2 shadow evidence is append-only';
END;
$$;

CREATE TRIGGER trg_inventory_forecast_v2_activation_immutable
  BEFORE UPDATE OR DELETE ON research.inventory_forecast_v2_activation
  FOR EACH ROW EXECUTE FUNCTION research.reject_inventory_forecast_v2_mutation();
CREATE TRIGGER trg_inventory_forecast_v2_predictions_immutable
  BEFORE UPDATE OR DELETE ON research.inventory_forecast_v2_predictions
  FOR EACH ROW EXECUTE FUNCTION research.reject_inventory_forecast_v2_mutation();
CREATE TRIGGER trg_inventory_forecast_v2_manifest_immutable
  BEFORE UPDATE OR DELETE ON research.inventory_forecast_v2_manifest
  FOR EACH ROW EXECUTE FUNCTION research.reject_inventory_forecast_v2_mutation();
CREATE TRIGGER trg_inventory_forecast_v2_capture_audit_immutable
  BEFORE UPDATE OR DELETE ON research.inventory_forecast_v2_capture_audit
  FOR EACH ROW EXECUTE FUNCTION research.reject_inventory_forecast_v2_mutation();

REVOKE UPDATE, DELETE ON research.inventory_forecast_v2_activation,
  research.inventory_forecast_v2_predictions,
  research.inventory_forecast_v2_manifest,
  research.inventory_forecast_v2_capture_audit FROM PUBLIC;

COMMIT;
