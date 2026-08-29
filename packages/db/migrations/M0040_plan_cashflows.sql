BEGIN;

-- Entry funding can mutate wallet capital before a PositionV2 exists.  Keep
-- this plan-scoped ledger separate from position cashflows so an aborted
-- entry retains an auditable SOL outcome instead of becoming unowned state.
CREATE TABLE IF NOT EXISTS execution.plan_cashflows(
  cashflow_id text PRIMARY KEY,
  plan_id text NOT NULL REFERENCES execution.transaction_plans(plan_id),
  flow_type text NOT NULL CHECK(flow_type IN (
    'ENTRY_FUNDING_SOL_OUT',
    'ENTRY_FUNDING_X_IN',
    'FUNDING_TX_COST',
    'RECOVERY_UNWIND_X_OUT',
    'RECOVERY_SOL_IN',
    'RECOVERY_TX_COST'
  )),
  observed_at timestamptz NOT NULL,
  lamports bigint,
  token_mint text,
  token_amount_raw numeric(78,0),
  transaction_signature text,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS plan_cashflows_plan_time_idx
  ON execution.plan_cashflows(plan_id,observed_at,cashflow_id);

-- These terminal states distinguish a successfully opened funded entry from
-- an expired/failed entry whose paired inventory has been safely returned to
-- SOL.  Neither is eligible for further partial-entry recovery work.
ALTER TABLE execution.partial_entry_recovery
  DROP CONSTRAINT IF EXISTS partial_entry_recovery_state_check;
ALTER TABLE execution.partial_entry_recovery
  ADD CONSTRAINT partial_entry_recovery_state_check CHECK(state IN (
    'ENTRY_FUNDED_NOT_OPEN','RESUME_OPEN','UNWIND_REQUIRED','UNWIND_SUBMITTED',
    'RESOLVED','RECONCILIATION_REQUIRED','OPEN_RECOVERED','ABORTED_SOL_SETTLED'
  ));

COMMIT;
