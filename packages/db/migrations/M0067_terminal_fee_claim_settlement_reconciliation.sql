-- M0067: receipt-backed terminal settlement integrity.
-- Historical settlements remain immutable. New terminal settlements require a
-- separately persisted chain/wallet reconciliation before SOL_SETTLED.

BEGIN;

CREATE TABLE IF NOT EXISTS execution.lifecycle_settlement_chain_reconciliations (
  lifecycle_id text PRIMARY KEY REFERENCES execution.position_lifecycles(lifecycle_id),
  position_address text NOT NULL,
  close_plan_id text NOT NULL REFERENCES execution.transaction_plans(plan_id),
  status text NOT NULL CHECK (status IN ('RECONCILED_CHAIN','RECONCILIATION_REQUIRED')),
  chain_sol_in_lamports bigint NOT NULL,
  chain_sol_out_lamports bigint NOT NULL,
  chain_net_sol_pnl_lamports bigint NOT NULL,
  db_sol_in_lamports bigint NOT NULL,
  db_sol_out_lamports bigint NOT NULL,
  db_net_sol_pnl_lamports bigint NOT NULL,
  difference_lamports bigint NOT NULL,
  reason_codes jsonb NOT NULL DEFAULT '[]'::jsonb,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  observed_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL
);

CREATE INDEX IF NOT EXISTS lifecycle_settlement_chain_reconciliations_status_idx
  ON execution.lifecycle_settlement_chain_reconciliations(status, observed_at DESC);

COMMIT;
