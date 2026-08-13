BEGIN;
CREATE TABLE IF NOT EXISTS research.pool_deep_screen_observations (
  id BIGSERIAL PRIMARY KEY,
  pool_address TEXT NOT NULL,
  observed_at TIMESTAMPTZ NOT NULL,
  policy_id TEXT NOT NULL,
  eligibility TEXT NOT NULL CHECK (eligibility IN ('QUALIFIED','WATCHLIST','BLOCK','QUARANTINED')),
  pool_quality_score DOUBLE PRECISION NOT NULL,
  current_opportunity_score DOUBLE PRECISION NOT NULL,
  executable_liquidity_score DOUBLE PRECISION NOT NULL,
  fee_quality_score DOUBLE PRECISION NOT NULL,
  flow_quality_score DOUBLE PRECISION NOT NULL,
  toxicity_probability DOUBLE PRECISION NOT NULL,
  opportunity_half_life_minutes DOUBLE PRECISION,
  reason_codes JSONB NOT NULL DEFAULT '[]'::jsonb,
  evidence_availability JSONB NOT NULL DEFAULT '{}'::jsonb,
  payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  UNIQUE(pool_address, observed_at, policy_id)
);
CREATE INDEX IF NOT EXISTS idx_pool_deep_screen_pool_time ON research.pool_deep_screen_observations(pool_address,observed_at DESC);
CREATE INDEX IF NOT EXISTS idx_pool_deep_screen_eligibility ON research.pool_deep_screen_observations(eligibility,current_opportunity_score DESC);
CREATE TABLE IF NOT EXISTS market.pool_universe_assignments (
  assignment_cycle_id TEXT NOT NULL,
  pool_address TEXT NOT NULL,
  observed_at TIMESTAMPTZ NOT NULL,
  policy_id TEXT NOT NULL,
  tier TEXT NOT NULL CHECK (tier IN ('A','B','C','CONTROL','COOLDOWN','REJECTED','QUARANTINED')),
  rank INTEGER,
  deep_priority DOUBLE PRECISION NOT NULL,
  control_cohort BOOLEAN NOT NULL DEFAULT FALSE,
  selection_probability DOUBLE PRECISION NOT NULL DEFAULT 1,
  opportunity_half_life_minutes DOUBLE PRECISION,
  selection_reason JSONB NOT NULL DEFAULT '[]'::jsonb,
  payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  PRIMARY KEY(assignment_cycle_id,pool_address)
);
CREATE INDEX IF NOT EXISTS idx_pool_universe_active ON market.pool_universe_assignments(observed_at DESC,tier,rank);
CREATE TABLE IF NOT EXISTS research.discovery_predictions (
  prediction_id TEXT PRIMARY KEY,
  pool_address TEXT NOT NULL,
  observed_at TIMESTAMPTZ NOT NULL,
  policy_version TEXT NOT NULL,
  model_version TEXT NOT NULL,
  cohort TEXT NOT NULL,
  episode_key TEXT NOT NULL,
  selected_action TEXT NOT NULL,
  selection_context JSONB NOT NULL,
  prediction JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_discovery_predictions_pool_time ON research.discovery_predictions(pool_address,observed_at DESC);
CREATE INDEX IF NOT EXISTS idx_discovery_predictions_episode ON research.discovery_predictions(episode_key);
CREATE TABLE IF NOT EXISTS research.discovery_outcomes (
  id BIGSERIAL PRIMARY KEY,
  prediction_id TEXT NOT NULL REFERENCES research.discovery_predictions(prediction_id) ON DELETE CASCADE,
  pool_address TEXT NOT NULL,
  observed_at TIMESTAMPTZ NOT NULL,
  horizon_minutes INTEGER NOT NULL,
  outcome_class TEXT NOT NULL CHECK(outcome_class IN ('TRADED','NO_TRADE_COUNTERFACTUAL','CONTROL_COUNTERFACTUAL')),
  event_attribution TEXT NOT NULL,
  structural_event_codes JSONB NOT NULL DEFAULT '[]'::jsonb,
  realized_net_value DOUBLE PRECISION,
  realized_fees DOUBLE PRECISION,
  realized_directional_pnl DOUBLE PRECISION,
  range_survived BOOLEAN,
  inventory_conversion DOUBLE PRECISION,
  payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  UNIQUE(prediction_id,horizon_minutes)
);
CREATE TABLE IF NOT EXISTS research.discovery_reputation (
  reputation_key TEXT PRIMARY KEY,
  level TEXT NOT NULL,
  as_of TIMESTAMPTZ NOT NULL,
  samples INTEGER NOT NULL,
  independent_episodes INTEGER NOT NULL,
  mean_net DOUBLE PRECISION NOT NULL,
  positive_rate DOUBLE PRECISION NOT NULL,
  confidence DOUBLE PRECISION NOT NULL,
  payload JSONB NOT NULL DEFAULT '{}'::jsonb
);
CREATE TABLE IF NOT EXISTS research.discovery_calibration_snapshots (
  snapshot_id TEXT PRIMARY KEY,
  observed_at TIMESTAMPTZ NOT NULL,
  model_version TEXT NOT NULL,
  sample_count INTEGER NOT NULL,
  independent_episodes INTEGER NOT NULL,
  brier_profit DOUBLE PRECISION,
  survival_brier DOUBLE PRECISION,
  net_value_mae DOUBLE PRECISION,
  mean_bias DOUBLE PRECISION,
  all_outcome_net DOUBLE PRECISION NOT NULL,
  model_calibration_net DOUBLE PRECISION NOT NULL,
  payload JSONB NOT NULL DEFAULT '{}'::jsonb
);
CREATE TABLE IF NOT EXISTS research.discovery_baseline_results (
  run_id TEXT NOT NULL,
  observed_at TIMESTAMPTZ NOT NULL,
  baseline_id TEXT NOT NULL,
  selected_pool_address TEXT,
  information_cutoff TIMESTAMPTZ NOT NULL,
  result JSONB NOT NULL DEFAULT '{}'::jsonb,
  PRIMARY KEY(run_id,baseline_id)
);
CREATE TABLE IF NOT EXISTS research.discovery_policy_proposals (
  proposal_id TEXT PRIMARY KEY,
  created_at TIMESTAMPTZ NOT NULL,
  state TEXT NOT NULL,
  hypothesis TEXT NOT NULL,
  target_policy TEXT NOT NULL,
  changes JSONB NOT NULL,
  evidence JSONB NOT NULL,
  automatic_promotion BOOLEAN NOT NULL DEFAULT FALSE CHECK(automatic_promotion=FALSE)
);
COMMIT;
