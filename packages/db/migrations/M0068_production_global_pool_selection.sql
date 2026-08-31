BEGIN;

CREATE TABLE IF NOT EXISTS execution.production_global_selection_cycles (
  global_cycle_id text PRIMARY KEY,
  policy_version text NOT NULL,
  reentry_context_policy_version text NOT NULL,
  decision_cutoff timestamptz NOT NULL,
  started_at timestamptz NOT NULL,
  completed_at timestamptz NOT NULL,
  eligible_pool_count integer NOT NULL,
  evaluated_pool_count integer NOT NULL,
  candidate_pool_count integer NOT NULL,
  coverage_state text NOT NULL,
  outcome text NOT NULL,
  winner_pool_address text,
  winner_candidate_id text,
  runner_up_pool_address text,
  ranking_metric text NOT NULL,
  cross_pool_metrics_comparable boolean NOT NULL,
  reason_codes jsonb NOT NULL DEFAULT '[]'::jsonb,
  source_commit text,
  build_id text,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS execution.production_global_pool_candidates (
  global_cycle_id text NOT NULL REFERENCES execution.production_global_selection_cycles(global_cycle_id) ON DELETE CASCADE,
  pool_address text NOT NULL,
  evaluation_order integer NOT NULL,
  candidate_rank integer,
  candidate_state text NOT NULL,
  recommendation_id text,
  thesis_id text,
  candidate_id text,
  strategy text,
  orientation text,
  lower_bin_id integer,
  upper_bin_id integer,
  active_bin_id integer,
  risk_adjusted_expected_net_ev numeric,
  predicted_fees numeric,
  predicted_inventory_pnl numeric,
  capital_value numeric,
  horizon_minutes integer,
  decision_at timestamptz,
  expires_at timestamptz,
  phase3_state text,
  phase4_state text,
  reason_codes jsonb NOT NULL DEFAULT '[]'::jsonb,
  history_context jsonb NOT NULL DEFAULT '{}'::jsonb,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  PRIMARY KEY(global_cycle_id,pool_address)
);
CREATE INDEX IF NOT EXISTS production_global_selection_cycles_cutoff_idx ON execution.production_global_selection_cycles(decision_cutoff DESC);
CREATE INDEX IF NOT EXISTS production_global_pool_candidates_pool_idx ON execution.production_global_pool_candidates(pool_address,global_cycle_id DESC);

COMMIT;
