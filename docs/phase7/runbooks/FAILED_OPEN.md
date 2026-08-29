# Failed position OPEN

**Runbook ID:** `FAILED_OPEN`

## Procedure

1. Stop retries until submission state is classified.
2. If status is UNKNOWN and blockhash remains valid, do not resubmit.
3. Read chain state and execution journal; reconcile economic effect.
4. Only rebuild after expiry and proof that effect is absent.
5. Record incident and operator evidence.

## Exit evidence

- incident/control audit ID;
- health assessment;
- reconciliation status;
- relevant transaction/position evidence where applicable;
- explicit audited resume/rollback decision.
