-- M0066: durable read-only owned-position management observations.
-- This table is additive.  Existing observations/outcomes remain immutable.

BEGIN;

CREATE TABLE IF NOT EXISTS execution.position_management_metrics (
  lpforge_position_id text NOT NULL REFERENCES execution.owned_positions(lpforge_position_id),
  observed_at timestamptz NOT NULL,
  policy_version text NOT NULL,
  managed_nav_usd numeric,
  current_return_fraction numeric,
  inventory_value_usd numeric,
  cumulative_gross_fees_usd numeric,
  mfe_managed_nav_usd numeric,
  mfe_return_fraction numeric,
  mfe_observed_at timestamptz,
  mfe_active_bin integer,
  mfe_inventory_value_usd numeric,
  mfe_cumulative_gross_fees_usd numeric,
  inventory_deterioration_since_mfe_usd numeric,
  gross_fees_since_mfe_usd numeric,
  fee_compensation_ratio numeric,
  economic_classification text NOT NULL,
  token_inventory_share numeric,
  sol_inventory_share numeric,
  flow_evidence_status text NOT NULL,
  continuation_evidence_available boolean NOT NULL,
  continuation_evidence_age_seconds integer,
  continuation_expected_net_ev_lamports bigint,
  continuation_uncertainty numeric,
  continuation_reason_codes jsonb NOT NULL DEFAULT '[]'::jsonb,
  management_hold_classification text NOT NULL,
  action_lane_state text NOT NULL,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (lpforge_position_id, observed_at)
);

CREATE INDEX IF NOT EXISTS position_management_metrics_position_observed_idx
  ON execution.position_management_metrics(lpforge_position_id, observed_at DESC);

COMMIT;
