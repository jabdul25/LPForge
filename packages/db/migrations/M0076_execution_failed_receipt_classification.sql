BEGIN;

-- A finalized program failure is a landed transaction with a fee receipt. It
-- is not equivalent to a blockhash-expired transaction that never landed.
ALTER TABLE execution.open_chunk_dispositions
  DROP CONSTRAINT IF EXISTS open_chunk_dispositions_disposition_check;
ALTER TABLE execution.open_chunk_dispositions
  ADD CONSTRAINT open_chunk_dispositions_disposition_check CHECK(disposition IN (
    'PENDING','SIGNING','SIGNED','SUBMITTED','CONFIRMED','CONFIRMED_FAILED',
    'UNKNOWN_SUBMISSION','PROVEN_NOT_LANDED','FAILED_PRE_SIGN',
    'EXPIRED_PRE_SUBMISSION'
  ));

-- OPEN transactions can fail after landing before a PositionV2 lifecycle is
-- available. Preserve their network cost on the plan-scoped receipt ledger.
ALTER TABLE execution.plan_cashflows
  DROP CONSTRAINT IF EXISTS plan_cashflows_flow_type_check;
ALTER TABLE execution.plan_cashflows
  ADD CONSTRAINT plan_cashflows_flow_type_check CHECK(flow_type IN (
    'ENTRY_FUNDING_SOL_OUT','ENTRY_FUNDING_X_IN','FUNDING_TX_COST',
    'EXECUTION_TX_COST','RECOVERY_UNWIND_X_OUT','RECOVERY_SOL_IN',
    'RECOVERY_TX_COST'
  ));

COMMIT;
