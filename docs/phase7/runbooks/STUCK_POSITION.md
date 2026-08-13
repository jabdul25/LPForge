# Stuck or stale position

**Runbook ID:** `STUCK_POSITION`

## Procedure

1. Pause new exposure for the affected pool.
2. Refresh PositionV2, active bin, wallet balances and pending submissions.
3. Classify IN_RANGE/OOR/reconciliation state.
4. Route CLOSE or recovery only through risk/execution workflow.

## Exit evidence

- incident/control audit ID;
- health assessment;
- reconciliation status;
- relevant transaction/position evidence where applicable;
- explicit audited resume/rollback decision.
