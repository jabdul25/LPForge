BEGIN;

-- Research-only post-entry telemetry starts prospectively at migration time.
-- Existing forward decisions are intentionally not backfilled from mutable
-- operational tables: the activation watermark is part of the evidence
-- contract and prevents outcome-informed historical path reconstruction.
CREATE TABLE IF NOT EXISTS research.post_entry_telemetry_activation(
  activation_id text PRIMARY KEY,
  activated_at timestamptz NOT NULL,
  telemetry_schema_version text NOT NULL,
  authority text NOT NULL CHECK(authority='RESEARCH_ONLY_NO_POLICY_MUTATION'),
  created_at timestamptz NOT NULL DEFAULT now()
);

INSERT INTO research.post_entry_telemetry_activation(
  activation_id,activated_at,telemetry_schema_version,authority
) VALUES(
  'post-entry-state-telemetry-v2',now(),'post-entry-state-telemetry-v2','RESEARCH_ONLY_NO_POLICY_MUTATION'
) ON CONFLICT(activation_id) DO NOTHING;

CREATE TABLE IF NOT EXISTS research.post_entry_telemetry_episodes(
  telemetry_episode_id text PRIMARY KEY,
  recommendation_id text NOT NULL UNIQUE REFERENCES research.phase3_forward_decisions(recommendation_id),
  decision_id text NOT NULL UNIQUE,
  pool_address text NOT NULL REFERENCES protocol.pools(address),
  decision_at timestamptz NOT NULL,
  phase4_evaluated_at timestamptz,
  source_sha text NOT NULL,
  build_id text NOT NULL,
  migration_head text NOT NULL,
  telemetry_schema_version text NOT NULL,
  outcome_model_version text NOT NULL,
  frozen_position_status text NOT NULL CHECK(frozen_position_status IN ('AVAILABLE_FOR_RESEARCH_REPLAY','FROZEN_POSITION_UNAVAILABLE')),
  frozen_header jsonb NOT NULL,
  header_hash text NOT NULL,
  captured_at timestamptz NOT NULL,
  authority text NOT NULL CHECK(authority='RESEARCH_ONLY_NO_POLICY_MUTATION'),
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK(source_sha ~ '^[0-9a-f]{40}$'),
  CHECK(build_id ~ '^[0-9a-f]{64}$'),
  CHECK(migration_head ~ '^M[0-9]{4}_.+\.sql$'),
  CHECK(header_hash ~ '^[0-9a-f]{64}$')
);

CREATE INDEX IF NOT EXISTS post_entry_telemetry_episodes_due_idx
  ON research.post_entry_telemetry_episodes(decision_at ASC);
CREATE INDEX IF NOT EXISTS post_entry_telemetry_episodes_pool_time_idx
  ON research.post_entry_telemetry_episodes(pool_address,decision_at ASC);

CREATE TABLE IF NOT EXISTS research.post_entry_telemetry_observations(
  observation_id text PRIMARY KEY,
  telemetry_episode_id text NOT NULL REFERENCES research.post_entry_telemetry_episodes(telemetry_episode_id),
  sequence_number integer NOT NULL CHECK(sequence_number > 0),
  checkpoint_key text NOT NULL,
  observation_type text NOT NULL CHECK(observation_type IN ('ENTRY','CHECKPOINT','FINALIZATION')),
  target_at timestamptz NOT NULL,
  observed_at timestamptz,
  captured_at timestamptz NOT NULL,
  checkpoint_status text NOT NULL CHECK(checkpoint_status IN ('OBSERVED','MISSED','DELAYED','SOURCE_UNAVAILABLE','DUPLICATE_REJECTED','INTEGRITY_CONFLICT')),
  source_version text NOT NULL,
  collector_version text NOT NULL,
  valuation_contract_version text NOT NULL,
  content_hash text NOT NULL,
  content jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(telemetry_episode_id,sequence_number),
  UNIQUE(telemetry_episode_id,checkpoint_key),
  CHECK(content_hash ~ '^[0-9a-f]{64}$')
);

CREATE INDEX IF NOT EXISTS post_entry_telemetry_observations_episode_target_idx
  ON research.post_entry_telemetry_observations(telemetry_episode_id,target_at ASC);

-- The manifest is a separate append-only chain.  Its initial previous_hash
-- is the immutable episode header hash; each subsequent entry binds its
-- complete observation payload by content_hash and sequence number.
CREATE TABLE IF NOT EXISTS research.telemetry_manifest(
  telemetry_episode_id text NOT NULL REFERENCES research.post_entry_telemetry_episodes(telemetry_episode_id),
  sequence_number integer NOT NULL CHECK(sequence_number > 0),
  observation_id text NOT NULL UNIQUE REFERENCES research.post_entry_telemetry_observations(observation_id),
  observation_type text NOT NULL,
  observed_at timestamptz,
  captured_at timestamptz NOT NULL,
  source_version text NOT NULL,
  collector_version text NOT NULL,
  content_hash text NOT NULL,
  previous_hash text NOT NULL,
  current_hash text NOT NULL,
  capture_status text NOT NULL CHECK(capture_status IN ('OBSERVED','MISSED','DELAYED','SOURCE_UNAVAILABLE','DUPLICATE_REJECTED','INTEGRITY_CONFLICT')),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(telemetry_episode_id,sequence_number),
  CHECK(content_hash ~ '^[0-9a-f]{64}$'),
  CHECK(previous_hash ~ '^[0-9a-f]{64}$'),
  CHECK(current_hash ~ '^[0-9a-f]{64}$')
);

CREATE TABLE IF NOT EXISTS research.post_entry_telemetry_capture_audit(
  audit_id bigserial PRIMARY KEY,
  telemetry_episode_id text NOT NULL REFERENCES research.post_entry_telemetry_episodes(telemetry_episode_id),
  checkpoint_key text NOT NULL,
  attempted_at timestamptz NOT NULL,
  capture_status text NOT NULL CHECK(capture_status IN ('INSERTED','DUPLICATE_REJECTED','INTEGRITY_CONFLICT')),
  attempted_content_hash text NOT NULL,
  detail jsonb NOT NULL DEFAULT '{}'::jsonb,
  authority text NOT NULL CHECK(authority='RESEARCH_ONLY_NO_POLICY_MUTATION'),
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK(attempted_content_hash ~ '^[0-9a-f]{64}$')
);

CREATE INDEX IF NOT EXISTS post_entry_telemetry_capture_audit_episode_idx
  ON research.post_entry_telemetry_capture_audit(telemetry_episode_id,attempted_at ASC);

CREATE OR REPLACE FUNCTION research.reject_post_entry_telemetry_mutation() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'post-entry telemetry evidence is append-only';
END;
$$;

DROP TRIGGER IF EXISTS trg_post_entry_telemetry_episodes_immutable ON research.post_entry_telemetry_episodes;
CREATE TRIGGER trg_post_entry_telemetry_episodes_immutable
  BEFORE UPDATE OR DELETE ON research.post_entry_telemetry_episodes
  FOR EACH ROW EXECUTE FUNCTION research.reject_post_entry_telemetry_mutation();

DROP TRIGGER IF EXISTS trg_post_entry_telemetry_observations_immutable ON research.post_entry_telemetry_observations;
CREATE TRIGGER trg_post_entry_telemetry_observations_immutable
  BEFORE UPDATE OR DELETE ON research.post_entry_telemetry_observations
  FOR EACH ROW EXECUTE FUNCTION research.reject_post_entry_telemetry_mutation();

DROP TRIGGER IF EXISTS trg_telemetry_manifest_immutable ON research.telemetry_manifest;
CREATE TRIGGER trg_telemetry_manifest_immutable
  BEFORE UPDATE OR DELETE ON research.telemetry_manifest
  FOR EACH ROW EXECUTE FUNCTION research.reject_post_entry_telemetry_mutation();

DROP TRIGGER IF EXISTS trg_post_entry_telemetry_capture_audit_immutable ON research.post_entry_telemetry_capture_audit;
CREATE TRIGGER trg_post_entry_telemetry_capture_audit_immutable
  BEFORE UPDATE OR DELETE ON research.post_entry_telemetry_capture_audit
  FOR EACH ROW EXECUTE FUNCTION research.reject_post_entry_telemetry_mutation();

REVOKE UPDATE, DELETE ON research.post_entry_telemetry_episodes,
  research.post_entry_telemetry_observations,
  research.telemetry_manifest,
  research.post_entry_telemetry_capture_audit FROM PUBLIC;

COMMIT;
