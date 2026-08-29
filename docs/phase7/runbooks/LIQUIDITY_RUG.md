# Liquidity/token emergency

**Runbook ID:** `LIQUIDITY_RUG`

## Procedure

1. Block the pool/token and suppress new entries immediately.
2. Refresh on-chain liquidity, token authority and market state.
3. Evaluate emergency close using current execution/reconciliation gates.
4. Do not rely on stale API liquidity.
5. Preserve post-incident evidence for forensics.

## Exit evidence

- incident/control audit ID;
- health assessment;
- reconciliation status;
- relevant transaction/position evidence where applicable;
- explicit audited resume/rollback decision.
