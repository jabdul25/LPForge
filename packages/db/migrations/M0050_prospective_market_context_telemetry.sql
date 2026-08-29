BEGIN;

-- M0050 extends M0049 prospectively. It deliberately creates no historical
-- context rows. The runtime inserts a single artifact-bound activation
-- watermark before it captures the first eligible M0050 episode.
CREATE TABLE IF NOT EXISTS research.market_context_telemetry_activation(
  activation_id text PRIMARY KEY,
  activated_at timestamptz NOT NULL,
  source_sha text NOT NULL,
  build_id text NOT NULL,
  migration_version text NOT NULL,
  telemetry_schema_version text NOT NULL,
  market_context_schema_version text NOT NULL,
  market_context_model_version text NOT NULL,
  collector_version text NOT NULL,
  authority text NOT NULL CHECK(authority='RESEARCH_ONLY_NO_POLICY_MUTATION'),
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK(source_sha ~ '^[0-9a-f]{40}$'),
  CHECK(build_id ~ '^[0-9a-f]{64}$'),
  CHECK(migration_version='M0050_prospective_market_context_telemetry.sql')
);

CREATE TABLE IF NOT EXISTS research.market_context_telemetry_snapshots(
  market_context_snapshot_id text PRIMARY KEY,
  telemetry_episode_id text NOT NULL REFERENCES research.post_entry_telemetry_episodes(telemetry_episode_id),
  recommendation_id text NOT NULL,
  pool_address text NOT NULL REFERENCES protocol.pools(address),
  decision_at timestamptz NOT NULL,
  captured_at timestamptz NOT NULL,
  decision_source_sha text NOT NULL,
  decision_build_id text NOT NULL,
  decision_migration_head text NOT NULL,
  telemetry_schema_version text NOT NULL,
  market_context_schema_version text NOT NULL,
  market_context_model_version text NOT NULL,
  regime_model_version text,
  volatility_model_version text,
  collector_version text NOT NULL,
  capture_status text NOT NULL CHECK(capture_status IN ('OBSERVED','PARTIAL','SOURCE_UNAVAILABLE','SOURCE_STALE','SOURCE_TIMESTAMP_UNVERIFIED','DUPLICATE_REJECTED','INTEGRITY_CONFLICT','PRE_ACTIVATION_NOT_APPLICABLE')),
  reason_codes jsonb NOT NULL DEFAULT '[]'::jsonb,
  availability jsonb NOT NULL,
  raw_payload jsonb NOT NULL,
  derived_interpretation jsonb NOT NULL,
  provenance jsonb NOT NULL,
  content_hash text NOT NULL,
  authority text NOT NULL CHECK(authority='RESEARCH_ONLY_NO_POLICY_MUTATION'),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(telemetry_episode_id,market_context_model_version),
  UNIQUE(recommendation_id,market_context_model_version),
  CHECK(decision_source_sha ~ '^[0-9a-f]{40}$'),
  CHECK(decision_build_id ~ '^[0-9a-f]{64}$'),
  CHECK(decision_migration_head ~ '^M[0-9]{4}_.+\\.sql$'),
  CHECK(content_hash ~ '^[0-9a-f]{64}$')
);

CREATE INDEX IF NOT EXISTS market_context_telemetry_snapshots_pool_time_idx
  ON research.market_context_telemetry_snapshots(pool_address,decision_at ASC);
CREATE INDEX IF NOT EXISTS market_context_telemetry_snapshots_status_idx
  ON research.market_context_telemetry_snapshots(capture_status,decision_at ASC);

CREATE TABLE IF NOT EXISTS research.market_context_telemetry_facts(
  market_context_fact_id text PRIMARY KEY,
  market_context_snapshot_id text NOT NULL REFERENCES research.market_context_telemetry_snapshots(market_context_snapshot_id),
  fact_key text NOT NULL,
  fact_layer text NOT NULL CHECK(fact_layer IN ('RAW_FACT','DERIVED_INTERPRETATION')),
  value jsonb NOT NULL,
  unit text NOT NULL,
  source_identity text NOT NULL,
  source_version text NOT NULL,
  source_observed_at timestamptz,
  source_age_ms bigint,
  source_window text,
  availability_status text NOT NULL CHECK(availability_status IN ('OBSERVED','PARTIAL','SOURCE_UNAVAILABLE','SOURCE_STALE','SOURCE_TIMESTAMP_UNVERIFIED','DUPLICATE_REJECTED','INTEGRITY_CONFLICT','PRE_ACTIVATION_NOT_APPLICABLE')),
  content_hash text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(market_context_snapshot_id,fact_key),
  CHECK(source_age_ms IS NULL OR source_age_ms>=0),
  CHECK(content_hash ~ '^[0-9a-f]{64}$')
);

CREATE INDEX IF NOT EXISTS market_context_telemetry_facts_query_idx
  ON research.market_context_telemetry_facts(fact_key,market_context_snapshot_id);
CREATE INDEX IF NOT EXISTS market_context_telemetry_facts_layer_idx
  ON research.market_context_telemetry_facts(fact_layer,availability_status);

-- This dedicated one-entry manifest chain is anchored to the immutable M0049
-- episode header hash. It binds the M0050 snapshot without rewriting M0049.
CREATE TABLE IF NOT EXISTS research.market_context_telemetry_manifest(
  market_context_snapshot_id text PRIMARY KEY REFERENCES research.market_context_telemetry_snapshots(market_context_snapshot_id),
  telemetry_episode_id text NOT NULL REFERENCES research.post_entry_telemetry_episodes(telemetry_episode_id),
  sequence_number integer NOT NULL CHECK(sequence_number=1),
  observed_at timestamptz NOT NULL,
  captured_at timestamptz NOT NULL,
  source_version text NOT NULL,
  collector_version text NOT NULL,
  market_context_model_version text NOT NULL,
  content_hash text NOT NULL,
  previous_hash text NOT NULL,
  current_hash text NOT NULL,
  capture_status text NOT NULL CHECK(capture_status IN ('OBSERVED','PARTIAL','SOURCE_UNAVAILABLE','SOURCE_STALE','SOURCE_TIMESTAMP_UNVERIFIED','DUPLICATE_REJECTED','INTEGRITY_CONFLICT','PRE_ACTIVATION_NOT_APPLICABLE')),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(telemetry_episode_id,market_context_model_version),
  CHECK(content_hash ~ '^[0-9a-f]{64}$'),
  CHECK(previous_hash ~ '^[0-9a-f]{64}$'),
  CHECK(current_hash ~ '^[0-9a-f]{64}$')
);

CREATE TABLE IF NOT EXISTS research.market_context_telemetry_capture_audit(
  audit_id bigserial PRIMARY KEY,
  telemetry_episode_id text NOT NULL REFERENCES research.post_entry_telemetry_episodes(telemetry_episode_id),
  market_context_model_version text NOT NULL,
  attempted_at timestamptz NOT NULL,
  capture_status text NOT NULL CHECK(capture_status IN ('ACTIVATED','INSERTED','DUPLICATE_REJECTED','INTEGRITY_CONFLICT')),
  attempted_content_hash text,
  detail jsonb NOT NULL DEFAULT '{}'::jsonb,
  authority text NOT NULL CHECK(authority='RESEARCH_ONLY_NO_POLICY_MUTATION'),
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK(attempted_content_hash IS NULL OR attempted_content_hash ~ '^[0-9a-f]{64}$')
);

CREATE INDEX IF NOT EXISTS market_context_telemetry_capture_audit_episode_idx
  ON research.market_context_telemetry_capture_audit(telemetry_episode_id,attempted_at ASC);

-- This view communicates the pre-activation contract without altering any
-- historical M0049 episode. It is intentionally a derived read-only status.
CREATE OR REPLACE VIEW research.market_context_telemetry_episode_status AS
SELECT
  e.telemetry_episode_id,
  e.recommendation_id,
  e.pool_address,
  e.decision_at,
  CASE
    WHEN a.activated_at IS NULL OR e.decision_at<a.activated_at THEN 'PRE_ACTIVATION_NOT_APPLICABLE'
    WHEN s.market_context_snapshot_id IS NULL THEN 'PENDING_PROSPECTIVE_CAPTURE'
    ELSE s.capture_status
  END AS market_context_capture_status
FROM research.post_entry_telemetry_episodes e
LEFT JOIN research.market_context_telemetry_activation a
  ON a.activation_id='m0050-prospective-market-context-telemetry-v1'
LEFT JOIN research.market_context_telemetry_snapshots s
  ON s.telemetry_episode_id=e.telemetry_episode_id
 AND s.market_context_model_version='phase3-decision-market-context-capture-v1';

CREATE OR REPLACE FUNCTION research.reject_market_context_telemetry_mutation() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'market-context telemetry evidence is append-only';
END;
$$;

DROP TRIGGER IF EXISTS trg_market_context_telemetry_activation_immutable ON research.market_context_telemetry_activation;
CREATE TRIGGER trg_market_context_telemetry_activation_immutable
  BEFORE UPDATE OR DELETE ON research.market_context_telemetry_activation
  FOR EACH ROW EXECUTE FUNCTION research.reject_market_context_telemetry_mutation();

DROP TRIGGER IF EXISTS trg_market_context_telemetry_snapshots_immutable ON research.market_context_telemetry_snapshots;
CREATE TRIGGER trg_market_context_telemetry_snapshots_immutable
  BEFORE UPDATE OR DELETE ON research.market_context_telemetry_snapshots
  FOR EACH ROW EXECUTE FUNCTION research.reject_market_context_telemetry_mutation();

DROP TRIGGER IF EXISTS trg_market_context_telemetry_facts_immutable ON research.market_context_telemetry_facts;
CREATE TRIGGER trg_market_context_telemetry_facts_immutable
  BEFORE UPDATE OR DELETE ON research.market_context_telemetry_facts
  FOR EACH ROW EXECUTE FUNCTION research.reject_market_context_telemetry_mutation();

DROP TRIGGER IF EXISTS trg_market_context_telemetry_manifest_immutable ON research.market_context_telemetry_manifest;
CREATE TRIGGER trg_market_context_telemetry_manifest_immutable
  BEFORE UPDATE OR DELETE ON research.market_context_telemetry_manifest
  FOR EACH ROW EXECUTE FUNCTION research.reject_market_context_telemetry_mutation();

DROP TRIGGER IF EXISTS trg_market_context_telemetry_capture_audit_immutable ON research.market_context_telemetry_capture_audit;
CREATE TRIGGER trg_market_context_telemetry_capture_audit_immutable
  BEFORE UPDATE OR DELETE ON research.market_context_telemetry_capture_audit
  FOR EACH ROW EXECUTE FUNCTION research.reject_market_context_telemetry_mutation();

REVOKE UPDATE, DELETE ON research.market_context_telemetry_activation,
  research.market_context_telemetry_snapshots,
  research.market_context_telemetry_facts,
  research.market_context_telemetry_manifest,
  research.market_context_telemetry_capture_audit FROM PUBLIC;

COMMIT;
