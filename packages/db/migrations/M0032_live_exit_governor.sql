BEGIN;
CREATE TABLE IF NOT EXISTS execution.position_exit_state(
  lpforge_position_id text PRIMARY KEY REFERENCES execution.owned_positions(lpforge_position_id),
  observed_at timestamptz NOT NULL,
  evidence_state text NOT NULL CHECK(evidence_state IN ('AVAILABLE','UNAVAILABLE','STALE','CONTRADICTORY')),
  initial_capital_usd numeric,
  current_economic_value_usd numeric,
  net_pnl_usd numeric,
  net_return_fraction numeric,
  peak_net_return_fraction numeric NOT NULL DEFAULT 0,
  peak_economic_value_usd numeric,
  peak_observed_at timestamptz NOT NULL,
  last_action text NOT NULL,
  last_reason_codes jsonb NOT NULL DEFAULT '[]'::jsonb,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  updated_at timestamptz NOT NULL
);
CREATE INDEX IF NOT EXISTS execution_position_exit_state_updated_idx ON execution.position_exit_state(updated_at DESC);

COMMIT;
