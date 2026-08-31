BEGIN;

-- Derived, restart-safe lifecycle state.  Position observations remain the
-- immutable per-cycle evidence; this row is a recomputable operational
-- aggregate and never changes historical outcomes.
CREATE TABLE IF NOT EXISTS execution.position_oor_lifecycle_state(
  position_address text PRIMARY KEY REFERENCES execution.owned_positions(position_address),
  lpforge_position_id text NOT NULL REFERENCES execution.owned_positions(lpforge_position_id),
  pool_address text NOT NULL REFERENCES protocol.pools(address),
  policy_version text NOT NULL,
  range_state text NOT NULL CHECK(range_state IN ('IN_RANGE','OUT_OF_RANGE')),
  lifecycle_state text NOT NULL CHECK(lifecycle_state IN ('IN_RANGE','TRANSIENT_OOR','SUSTAINED_OOR','OOR_ACTION_REQUIRED','OOR_STALE_CAPITAL')),
  direction text CHECK(direction IN ('ABOVE_MAX','BELOW_MIN')),
  inventory_classification text NOT NULL CHECK(inventory_classification IN ('SAFE_OOR_SOL','OOR_TOKEN_EXPOSURE','MIXED_INVENTORY','INVENTORY_UNAVAILABLE')),
  first_oor_detected_at timestamptz,
  continuous_oor_started_at timestamptz,
  latest_observed_at timestamptz NOT NULL,
  last_reentered_at timestamptz,
  oor_excursion_count integer NOT NULL DEFAULT 0 CHECK(oor_excursion_count>=0),
  total_oor_duration_seconds bigint NOT NULL DEFAULT 0 CHECK(total_oor_duration_seconds>=0),
  continuous_oor_duration_seconds bigint NOT NULL DEFAULT 0 CHECK(continuous_oor_duration_seconds>=0),
  last_active_bin_id integer,
  lower_bin_id integer NOT NULL,
  upper_bin_id integer NOT NULL,
  fee_value_at_oor_start_lamports bigint,
  fee_value_lamports bigint,
  fee_since_oor_lamports bigint,
  active_fee_rate_lamports_per_hour bigint,
  recommendation text NOT NULL,
  reason_codes jsonb NOT NULL DEFAULT '[]'::jsonb,
  chain_observed_at timestamptz,
  chain_slot bigint,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK((range_state='IN_RANGE' AND continuous_oor_started_at IS NULL AND continuous_oor_duration_seconds=0) OR range_state='OUT_OF_RANGE')
);
CREATE INDEX IF NOT EXISTS position_oor_lifecycle_open_idx ON execution.position_oor_lifecycle_state(lifecycle_state,latest_observed_at DESC);
CREATE INDEX IF NOT EXISTS position_oor_lifecycle_pool_idx ON execution.position_oor_lifecycle_state(pool_address,latest_observed_at DESC);

-- Compact, new-lifecycle accounting summary.  Immutable M0063 snapshots and
-- cashflows remain the primary evidence; this records their terminal join so
-- later learning does not need a UI or a destructive historical backfill.
CREATE TABLE IF NOT EXISTS execution.position_realized_economics(
  position_address text PRIMARY KEY REFERENCES execution.owned_positions(position_address),
  lifecycle_id text NOT NULL REFERENCES execution.position_lifecycles(lifecycle_id),
  entry_plan_id text,
  close_plan_id text REFERENCES execution.transaction_plans(plan_id),
  close_reason text,
  entry_capital_lamports bigint NOT NULL,
  gross_lp_fee_lamports bigint,
  rewards_lamports bigint,
  principal_returned_lamports bigint,
  inventory_unwind_pnl_lamports bigint,
  transaction_cost_lamports bigint,
  swap_cost_lamports bigint,
  rent_recovered_lamports bigint,
  final_realized_pnl_lamports bigint,
  accounting_reconciliation_difference_lamports bigint,
  fee_attribution_status text NOT NULL,
  accounting_status text NOT NULL CHECK(accounting_status IN ('COMPLETE','PARTIAL','UNAVAILABLE')),
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  finalized_at timestamptz
);
CREATE INDEX IF NOT EXISTS position_realized_economics_close_reason_idx ON execution.position_realized_economics(close_reason,finalized_at DESC);

COMMIT;
