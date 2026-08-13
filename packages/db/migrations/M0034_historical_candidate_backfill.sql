BEGIN;

-- Historical market points are deliberately separate from live snapshots.  The
-- timestamp is the market time; ingested_at records when LPForge acquired it.
CREATE TABLE IF NOT EXISTS market.candidate_market_observations(
  pool_address text NOT NULL,
  observed_at timestamptz NOT NULL,
  ingested_at timestamptz NOT NULL,
  source_type text NOT NULL CHECK(source_type IN ('LIVE_OBSERVED','HISTORICAL_API_BACKFILL','HISTORICAL_RPC_BACKFILL','RECONSTRUCTED')),
  source_provider text NOT NULL,
  price numeric NOT NULL,
  active_bin_id integer,
  resolution_ms integer NOT NULL DEFAULT 60000,
  volume numeric,
  fee_value numeric,
  local_liquidity numeric,
  source_hash text NOT NULL,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  PRIMARY KEY(pool_address,observed_at,source_type)
);
CREATE INDEX IF NOT EXISTS candidate_market_observations_pool_time_idx
  ON market.candidate_market_observations(pool_address,observed_at DESC);

-- One durable row per candidate avoids repeating a full historical request on
-- every collection tick while allowing safe retry after a partial/failed run.
CREATE TABLE IF NOT EXISTS market.active_candidate_backfill(
  pool_address text PRIMARY KEY,
  last_attempt_at timestamptz NOT NULL,
  last_successful_at timestamptz,
  requested_minutes integer NOT NULL,
  covered_minutes integer NOT NULL,
  coverage_ratio numeric NOT NULL,
  fee_bucket_count integer NOT NULL,
  ohlcv_bucket_count integer NOT NULL,
  swap_event_count integer NOT NULL,
  independent_15m_episodes integer NOT NULL,
  oldest_evidence_at timestamptz,
  newest_evidence_at timestamptz,
  quality text NOT NULL CHECK(quality IN ('SUFFICIENT','PARTIAL','INSUFFICIENT','DEGRADED')),
  reason_codes jsonb NOT NULL DEFAULT '[]'::jsonb,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb
);
CREATE INDEX IF NOT EXISTS active_candidate_backfill_quality_idx
  ON market.active_candidate_backfill(quality,last_successful_at DESC);

COMMIT;
