BEGIN;

-- Non-overlapping fee/volume buckets are retained independently from the
-- Data API's rolling-window fields.  They are research/observation evidence
-- only and have no execution or policy-mutation authority.
CREATE TABLE IF NOT EXISTS market.pool_fee_volume_observations(
  pool_address text NOT NULL,
  bucket_at timestamptz NOT NULL,
  source text NOT NULL,
  fees numeric,
  protocol_fees numeric,
  volume numeric,
  observed_at timestamptz NOT NULL,
  source_hash text NOT NULL,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  PRIMARY KEY(pool_address,bucket_at,source)
);
CREATE INDEX IF NOT EXISTS pool_fee_volume_observations_pool_time_idx
  ON market.pool_fee_volume_observations(pool_address,bucket_at DESC);

-- A compact, queryable explanation for a candidate's Phase-4 warm-up state.
CREATE TABLE IF NOT EXISTS market.active_candidate_history_maturity(
  pool_address text PRIMARY KEY,
  assessed_at timestamptz NOT NULL,
  state text NOT NULL CHECK(state IN ('WARMING','MATURE','STALE','DEGRADED')),
  market_observation_count integer NOT NULL,
  active_bin_observation_count integer NOT NULL,
  bin_frame_count integer NOT NULL,
  swap_event_count integer NOT NULL,
  oldest_observation_at timestamptz,
  latest_observation_at timestamptz,
  completeness_5m numeric NOT NULL,
  completeness_15m numeric NOT NULL,
  completeness_1h numeric NOT NULL,
  reason_codes jsonb NOT NULL DEFAULT '[]'::jsonb,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb
);
CREATE INDEX IF NOT EXISTS active_candidate_history_maturity_state_idx
  ON market.active_candidate_history_maturity(state,assessed_at DESC);

-- Each estimate references materialized underlying evidence and records both
-- raw and effective counts; it is deliberately separate from execution plans.
CREATE TABLE IF NOT EXISTS research.economic_estimates(
  economic_estimate_id text PRIMARY KEY,
  pool_address text NOT NULL,
  as_of timestamptz NOT NULL,
  fidelity text NOT NULL CHECK(fidelity IN ('AGGREGATE_ESTIMATE','EVENT_PATH_ESTIMATE','BIN_SHARE_REPLAY','ONCHAIN_POSITION')),
  raw_observation_count integer NOT NULL,
  effective_sample_count integer NOT NULL,
  independent_episode_count integer NOT NULL,
  fee_observation_count integer NOT NULL,
  event_path_observation_count integer NOT NULL,
  fee_rate_per_capital_hour numeric NOT NULL,
  uncertainty numeric NOT NULL,
  evidence_age_seconds numeric NOT NULL,
  source_hashes jsonb NOT NULL DEFAULT '{}'::jsonb,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb
);
CREATE INDEX IF NOT EXISTS economic_estimates_pool_as_of_idx
  ON research.economic_estimates(pool_address,as_of DESC);

COMMIT;
