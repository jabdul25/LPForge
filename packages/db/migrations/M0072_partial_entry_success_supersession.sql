BEGIN;

-- The runtime has a receipt- and owned-position-bound terminal state for a
-- funded entry whose eventual OPEN reconciled successfully.  M0040 predates
-- that state, so its check constraint otherwise rejects the safe
-- supersession write and leaves an already-open position in the recovery
-- queue.  This changes no economic state and does not alter prior rows.
ALTER TABLE execution.partial_entry_recovery
  DROP CONSTRAINT IF EXISTS partial_entry_recovery_state_check;
ALTER TABLE execution.partial_entry_recovery
  ADD CONSTRAINT partial_entry_recovery_state_check CHECK(state IN (
    'ENTRY_FUNDED_NOT_OPEN','RESUME_OPEN','UNWIND_REQUIRED','UNWIND_SUBMITTED',
    'RESOLVED','RECONCILIATION_REQUIRED','OPEN_RECOVERED',
    'SUPERSEDED_BY_SUCCESSFUL_ENTRY','ABORTED_SOL_SETTLED'
  ));

COMMIT;
