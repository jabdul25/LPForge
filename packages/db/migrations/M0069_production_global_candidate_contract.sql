BEGIN;

CREATE TABLE IF NOT EXISTS execution.production_global_candidates (
  global_cycle_id text NOT NULL,
  pool_address text NOT NULL,
  operational_cycle_id text NOT NULL,
  observed_at timestamptz NOT NULL,
  operational_state text NOT NULL CHECK(operational_state IN ('ENTRY_READY','NO_TRADE','WARMING','REJECTED')),
  phase4_state text NOT NULL,
  recommendation_id text,
  thesis_id text,
  candidate_id text,
  strategy text,
  orientation text,
  lower_bin_id integer,
  upper_bin_id integer,
  active_bin_id integer,
  capital_value numeric,
  horizon_minutes integer,
  predicted_gross_fees numeric,
  predicted_inventory_pnl numeric,
  predicted_net_ev numeric,
  risk_adjusted_expected_net_ev numeric,
  uncertainty numeric,
  confidence numeric,
  oor_risk numeric,
  event_path_evidence_at timestamptz,
  fee_evidence_at timestamptz,
  volume_evidence_at timestamptz,
  tvl numeric,
  fee_tvl_1h numeric,
  fee_tvl_24h numeric,
  reason_codes jsonb NOT NULL DEFAULT '[]'::jsonb,
  evidence jsonb NOT NULL DEFAULT '{}'::jsonb,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(global_cycle_id,pool_address),
  UNIQUE(global_cycle_id,operational_cycle_id)
);

CREATE INDEX IF NOT EXISTS production_global_candidates_cycle_idx
  ON execution.production_global_candidates(global_cycle_id,observed_at DESC);

CREATE INDEX IF NOT EXISTS production_global_candidates_pool_idx
  ON execution.production_global_candidates(pool_address,observed_at DESC);

COMMIT;
