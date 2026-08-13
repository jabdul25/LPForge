# RPC outage

**Runbook ID:** `RPC_OUTAGE`

## Procedure

1. Pause new entries.
2. Compare dedicated/private and secondary/public read providers for genesis, slot freshness and divergence.
3. Do not switch a write path to an unclassified public provider.
4. Recover pending submissions/reconciliation before resuming.
5. Resume only after P7 health is HEALTHY and operator action is audited.

## Exit evidence

- incident/control audit ID;
- health assessment;
- reconciliation status;
- relevant transaction/position evidence where applicable;
- explicit audited resume/rollback decision.
