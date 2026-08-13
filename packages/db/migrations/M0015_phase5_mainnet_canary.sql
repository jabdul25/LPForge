BEGIN;
CREATE TABLE IF NOT EXISTS execution.canary_runs(
  run_id text PRIMARY KEY,
  plan_id text REFERENCES execution.transaction_plans(plan_id),
  pool_address text NOT NULL,
  action text NOT NULL,
  capital_lamports numeric NOT NULL CHECK(capital_lamports>=0),
  status text NOT NULL CHECK(status IN ('BUILD_ONLY','SIMULATED','SUBMITTED','CONFIRMED','RECONCILED','FAILED','HOLD')),
  started_at timestamptz NOT NULL,
  ended_at timestamptz,
  signature text,
  reconciliation_status text,
  payload jsonb NOT NULL
);
CREATE INDEX IF NOT EXISTS canary_runs_started_idx ON execution.canary_runs(started_at DESC);
COMMIT;
