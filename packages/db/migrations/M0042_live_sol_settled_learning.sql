BEGIN;

-- The Phase-3 recommendation is the immutable forecast that authorized the
-- entry plan.  Store this link when PositionV2 is adopted; never recover it
-- later by matching a pool or timestamp.
CREATE TABLE IF NOT EXISTS research.lifecycle_prediction_lineage(
  lifecycle_id text PRIMARY KEY REFERENCES execution.position_lifecycles(lifecycle_id),
  entry_plan_id text NOT NULL REFERENCES execution.transaction_plans(plan_id),
  thesis_id text NOT NULL REFERENCES research.lp_theses(thesis_id),
  recommendation_id text NOT NULL REFERENCES research.shadow_recommendations(recommendation_id),
  prediction_id text NOT NULL,
  linked_at timestamptz NOT NULL,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  UNIQUE(entry_plan_id)
);

-- Backfill only facts with a real relational thesis/recommendation lineage.
INSERT INTO research.lifecycle_prediction_lineage(lifecycle_id,entry_plan_id,thesis_id,recommendation_id,prediction_id,linked_at,payload)
SELECT l.lifecycle_id,l.entry_plan_id,t.thesis_id,t.recommendation_id,t.recommendation_id,l.created_at,
       jsonb_build_object('backfilled',true,'predictionAuthority','PHASE3_RECOMMENDATION')
FROM execution.position_lifecycles l
JOIN research.lp_theses t ON t.thesis_id=(SELECT i.thesis_id FROM execution.transaction_plans p JOIN execution.intents i ON i.intent_id=p.intent_id WHERE p.plan_id=l.entry_plan_id)
WHERE l.entry_plan_id IS NOT NULL
ON CONFLICT(lifecycle_id) DO NOTHING;

CREATE TABLE IF NOT EXISTS research.live_learning_outcomes(
  outcome_id text PRIMARY KEY,
  outcome_kind text NOT NULL CHECK(outcome_kind IN ('LIVE_SOL_SETTLED','LIVE_ENTRY_ABORTED_SOL_SETTLED')),
  settlement_id text UNIQUE,
  lifecycle_id text UNIQUE REFERENCES execution.position_lifecycles(lifecycle_id),
  entry_plan_id text NOT NULL REFERENCES execution.transaction_plans(plan_id),
  prediction_id text NOT NULL,
  recommendation_id text NOT NULL REFERENCES research.shadow_recommendations(recommendation_id),
  thesis_id text NOT NULL REFERENCES research.lp_theses(thesis_id),
  pool_address text NOT NULL REFERENCES protocol.pools(address),
  strategy text,
  orientation text,
  lower_bin_id integer,
  upper_bin_id integer,
  entry_regime text,
  entry_regime_confidence numeric,
  entry_transition_risk numeric,
  capital_sol_lamports bigint,
  entry_at timestamptz,
  exit_at timestamptz,
  holding_duration_seconds bigint,
  realized_sol_pnl_lamports bigint NOT NULL,
  realized_return_fraction numeric,
  direct_fee_sol_lamports bigint,
  transaction_cost_lamports bigint,
  net_rent_cost_lamports bigint,
  management_action_count integer NOT NULL DEFAULT 0,
  claim_count integer NOT NULL DEFAULT 0,
  reduce_count integer NOT NULL DEFAULT 0,
  reshape_count integer NOT NULL DEFAULT 0,
  rebalance_count integer NOT NULL DEFAULT 0,
  exit_reason text,
  mfe_fraction numeric,
  mae_fraction numeric,
  oor_duration_seconds bigint,
  management_path jsonb NOT NULL DEFAULT '[]'::jsonb,
  decomposition jsonb NOT NULL DEFAULT '{}'::jsonb,
  source_commit text,
  policy_hash text,
  build_id text,
  migration_head text,
  evidence_hash text NOT NULL,
  created_at timestamptz NOT NULL,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb
);
-- A settlement-backed lifecycle and an aborted entry are each terminal once.
-- `settlement_id` is NULL for the latter, so it needs its own invariant.
CREATE UNIQUE INDEX IF NOT EXISTS live_learning_outcomes_kind_entry_plan_uq
  ON research.live_learning_outcomes(outcome_kind,entry_plan_id);
CREATE INDEX IF NOT EXISTS live_learning_outcomes_pool_strategy_idx ON research.live_learning_outcomes(pool_address,strategy,created_at);
CREATE INDEX IF NOT EXISTS live_learning_outcomes_prediction_idx ON research.live_learning_outcomes(prediction_id,created_at);

CREATE OR REPLACE FUNCTION research.prevent_live_learning_outcome_mutation() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'LPFORGE_LIVE_OUTCOME_IMMUTABLE';
END; $$ LANGUAGE plpgsql;
DROP TRIGGER IF EXISTS live_learning_outcomes_immutable ON research.live_learning_outcomes;
CREATE TRIGGER live_learning_outcomes_immutable BEFORE UPDATE OR DELETE ON research.live_learning_outcomes FOR EACH ROW EXECUTE FUNCTION research.prevent_live_learning_outcome_mutation();

CREATE TABLE IF NOT EXISTS research.live_learning_calibration_snapshots(
  snapshot_id text PRIMARY KEY,
  observed_at timestamptz NOT NULL,
  sample_count integer NOT NULL,
  independent_episodes integer NOT NULL,
  brier_profit numeric,
  net_pnl_mae_lamports numeric,
  mean_bias_lamports numeric,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb
);

COMMIT;
