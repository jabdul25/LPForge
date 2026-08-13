BEGIN;

CREATE TABLE IF NOT EXISTS market.pool_discovery_registry(
  pool_address text PRIMARY KEY,
  first_seen_at timestamptz NOT NULL,
  last_seen_at timestamptz NOT NULL,
  source_manual boolean NOT NULL DEFAULT false,
  source_auto boolean NOT NULL DEFAULT false,
  token_x_mint text,
  token_y_mint text,
  paired_token_mint text,
  paired_token_symbol text,
  market_cap_cohort text NOT NULL DEFAULT 'UNKNOWN',
  current_state text NOT NULL,
  current_tier text NOT NULL,
  last_priority_score numeric NOT NULL DEFAULT 0,
  last_rank integer,
  last_universe_percentile numeric,
  cooldown_until timestamptz,
  reason_codes jsonb NOT NULL DEFAULT '[]'::jsonb,
  evidence_state jsonb NOT NULL DEFAULT '{}'::jsonb,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb
);
CREATE INDEX IF NOT EXISTS pool_discovery_registry_tier_rank_idx ON market.pool_discovery_registry(current_tier,last_rank);
CREATE INDEX IF NOT EXISTS pool_discovery_registry_state_seen_idx ON market.pool_discovery_registry(current_state,last_seen_at DESC);

CREATE TABLE IF NOT EXISTS market.pool_discovery_observations(
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  pool_address text NOT NULL,
  observed_at timestamptz NOT NULL,
  policy_id text NOT NULL,
  source text NOT NULL,
  decision text NOT NULL,
  priority_score numeric NOT NULL,
  tvl_usd numeric,
  volume_30m_usd numeric,
  volume_1h_usd numeric,
  volume_24h_usd numeric,
  fees_30m_usd numeric,
  fees_1h_usd numeric,
  fees_24h_usd numeric,
  fee_tvl_30m numeric,
  fee_tvl_1h numeric,
  fee_tvl_24h numeric,
  market_cap_usd numeric,
  liquidity_to_market_cap numeric,
  volume_24h_to_market_cap numeric,
  fees_24h_to_market_cap numeric,
  holders numeric,
  hard_reasons jsonb NOT NULL DEFAULT '[]'::jsonb,
  warnings jsonb NOT NULL DEFAULT '[]'::jsonb,
  selection_reasons jsonb NOT NULL DEFAULT '[]'::jsonb,
  evidence_state jsonb NOT NULL DEFAULT '{}'::jsonb,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  UNIQUE(pool_address,observed_at,policy_id)
);
CREATE INDEX IF NOT EXISTS pool_discovery_observations_pool_time_idx ON market.pool_discovery_observations(pool_address,observed_at DESC);
CREATE INDEX IF NOT EXISTS pool_discovery_observations_policy_time_idx ON market.pool_discovery_observations(policy_id,observed_at DESC);

CREATE TABLE IF NOT EXISTS market.pool_discovery_rankings(
  ranking_cycle_id text NOT NULL,
  pool_address text NOT NULL,
  observed_at timestamptz NOT NULL,
  policy_id text NOT NULL,
  rank integer NOT NULL CHECK(rank>0),
  universe_percentile numeric NOT NULL,
  fee_percentile numeric,
  volume_percentile numeric,
  liquidity_percentile numeric,
  priority_score numeric NOT NULL,
  state text NOT NULL,
  tier text NOT NULL,
  reason_codes jsonb NOT NULL DEFAULT '[]'::jsonb,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  PRIMARY KEY(ranking_cycle_id,pool_address)
);
CREATE INDEX IF NOT EXISTS pool_discovery_rankings_cycle_rank_idx ON market.pool_discovery_rankings(ranking_cycle_id,rank);
CREATE INDEX IF NOT EXISTS pool_discovery_rankings_pool_time_idx ON market.pool_discovery_rankings(pool_address,observed_at DESC);

COMMIT;
