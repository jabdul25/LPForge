BEGIN;
CREATE TABLE IF NOT EXISTS execution.reconciliations(
  reconciliation_id text PRIMARY KEY,
  plan_id text NOT NULL REFERENCES execution.transaction_plans(plan_id),
  observed_at timestamptz NOT NULL,
  status text NOT NULL CHECK(status IN ('MATCH','MISMATCH','PARTIAL','UNKNOWN')),
  expected jsonb NOT NULL,
  actual jsonb NOT NULL,
  discrepancies jsonb NOT NULL,
  payload jsonb NOT NULL
);
CREATE INDEX IF NOT EXISTS execution_reconciliations_plan_time_idx ON execution.reconciliations(plan_id,observed_at DESC);
COMMIT;
