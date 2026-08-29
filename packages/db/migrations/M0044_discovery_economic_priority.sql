BEGIN;

ALTER TABLE market.pool_discovery_observations
  ADD COLUMN IF NOT EXISTS active_tvl_usd numeric,
  ADD COLUMN IF NOT EXISTS fee_total_tvl_ratio_30m_pct numeric,
  ADD COLUMN IF NOT EXISTS fee_total_tvl_ratio_1h_pct numeric,
  ADD COLUMN IF NOT EXISTS fee_total_tvl_ratio_24h_pct numeric,
  ADD COLUMN IF NOT EXISTS fee_active_tvl_ratio_30m_pct numeric,
  ADD COLUMN IF NOT EXISTS fee_active_tvl_ratio_1h_pct numeric,
  ADD COLUMN IF NOT EXISTS fee_active_tvl_ratio_24h_pct numeric,
  ADD COLUMN IF NOT EXISTS economic_priority numeric,
  ADD COLUMN IF NOT EXISTS metric_source text,
  ADD COLUMN IF NOT EXISTS metric_source_observed_at timestamptz,
  ADD COLUMN IF NOT EXISTS metric_ingested_at timestamptz;

CREATE INDEX IF NOT EXISTS pool_discovery_observations_economic_priority_idx
  ON market.pool_discovery_observations(observed_at DESC,economic_priority DESC NULLS LAST);

CREATE TABLE IF NOT EXISTS market.active_candidate_evidence_replacements(
  replacement_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  observed_at timestamptz NOT NULL,
  incumbent_pool_address text NOT NULL,
  challenger_pool_address text NOT NULL,
  reason_code text NOT NULL,
  incumbent_priority numeric NOT NULL,
  challenger_priority numeric NOT NULL,
  priority_delta numeric NOT NULL,
  incumbent_dwell_ms bigint NOT NULL,
  challenger_metric_observed_at timestamptz,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  UNIQUE(observed_at,incumbent_pool_address,challenger_pool_address)
);
CREATE INDEX IF NOT EXISTS active_candidate_evidence_replacements_time_idx
  ON market.active_candidate_evidence_replacements(observed_at DESC);

CREATE TABLE IF NOT EXISTS market.active_candidate_evidence_capacity_observations(
  observed_at timestamptz PRIMARY KEY,
  serviceable_capacity integer NOT NULL CHECK(serviceable_capacity>=0),
  production_monitored_count integer NOT NULL CHECK(production_monitored_count>=0),
  dynamic_capacity integer NOT NULL CHECK(dynamic_capacity>=0),
  active_count integer NOT NULL CHECK(active_count>=0),
  qualified_waiting_count integer NOT NULL CHECK(qualified_waiting_count>=0),
  candidate_slot_utilization numeric NOT NULL CHECK(candidate_slot_utilization>=0 AND candidate_slot_utilization<=1),
  replacement_count integer NOT NULL CHECK(replacement_count>=0),
  active_priority_min numeric,
  active_priority_max numeric,
  waiting_priority_min numeric,
  waiting_priority_max numeric,
  waiting_minutes_p50 numeric,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb
);
CREATE INDEX IF NOT EXISTS active_candidate_evidence_capacity_observations_time_idx
  ON market.active_candidate_evidence_capacity_observations(observed_at DESC);

COMMIT;
