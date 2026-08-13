BEGIN;
CREATE TABLE IF NOT EXISTS execution.execution_journal(
  journal_id text PRIMARY KEY,
  idempotency_key text NOT NULL UNIQUE,
  plan_id text NOT NULL REFERENCES execution.transaction_plans(plan_id),
  transaction_id text REFERENCES execution.transaction_steps(transaction_id),
  state text NOT NULL CHECK(state IN ('PLAN_CREATED','BUILT','SIMULATED','APPROVED','SIGNED','SUBMITTED','UNKNOWN_SUBMISSION','CONFIRMED','RECONCILED','EXPIRED','FAILED','HOLD')),
  signature text,
  blockhash text,
  last_valid_block_height bigint,
  version integer NOT NULL DEFAULT 1 CHECK(version>0),
  updated_at timestamptz NOT NULL,
  payload jsonb NOT NULL
);
CREATE INDEX IF NOT EXISTS execution_journal_state_idx ON execution.execution_journal(state,updated_at);
COMMIT;
