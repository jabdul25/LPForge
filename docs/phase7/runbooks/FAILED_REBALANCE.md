# Failed rebalance/reshape

**Runbook ID:** `FAILED_REBALANCE`

## Procedure

1. Suppress further management mutations for the position.
2. Reconcile old/new position and wallet inventory before another action.
3. Prefer HOLD/CLOSE_REVIEW when thesis remains uncertain.
4. Never chain a second rebalance onto unresolved state.

## Exit evidence

- incident/control audit ID;
- health assessment;
- reconciliation status;
- relevant transaction/position evidence where applicable;
- explicit audited resume/rollback decision.
