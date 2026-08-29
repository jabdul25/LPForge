BEGIN;

-- M0014 intentionally constrained the execution journal, but its original
-- state list lagged the durable P6 worker.  Keep the integrity check and make
-- it match the authoritative TypeScript ExecutionJournalState contract.
ALTER TABLE execution.execution_journal
  DROP CONSTRAINT IF EXISTS execution_journal_state_check;

ALTER TABLE execution.execution_journal
  ADD CONSTRAINT execution_journal_state_check CHECK (state IN (
    'PLAN_CREATED',
    'BUILT',
    'SIMULATED',
    'APPROVED',
    'SIGNING',
    'SIGNED',
    'SUBMITTED',
    'UNKNOWN_SUBMISSION',
    'CONFIRMED',
    'RECONCILIATION_REQUIRED',
    'RECONCILED',
    'EXPIRED',
    'FAILED',
    'HOLD'
  ));

-- The original canary run remains the immutable record of attempt 1.  This
-- table records the only permitted replacement path: a fresh plan can be
-- admitted once, only after the original plan has separately proved to be a
-- failed pre-sign, zero-exposure attempt.  It is deliberately not a counter
-- reset and cannot represent a third plan attempt.
CREATE TABLE IF NOT EXISTS execution.canary_pre_sign_replacements(
  campaign_id text PRIMARY KEY REFERENCES execution.canary_runs(run_id),
  failed_attempt_plan_id text NOT NULL UNIQUE REFERENCES execution.transaction_plans(plan_id),
  replacement_plan_id text NOT NULL UNIQUE REFERENCES execution.transaction_plans(plan_id),
  authorized_at timestamptz NOT NULL,
  payload jsonb NOT NULL,
  CHECK (failed_attempt_plan_id <> replacement_plan_id)
);

CREATE INDEX IF NOT EXISTS canary_pre_sign_replacements_replacement_plan_idx
  ON execution.canary_pre_sign_replacements(replacement_plan_id);

COMMIT;
