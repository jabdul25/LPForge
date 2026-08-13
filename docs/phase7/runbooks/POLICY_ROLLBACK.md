# Policy rollback

**Runbook ID:** `POLICY_ROLLBACK`

## Procedure

1. Pause new entries before rollback.
2. Select only an explicitly approved prior policy hash.
3. Verify code/config/feature-schema identity and rollback evidence.
4. Apply rollback as a control-plane change; do not mutate positions automatically.
5. Keep writes paused until health/reconciliation permit audited resume.

## Exit evidence

- incident/control audit ID;
- health assessment;
- reconciliation status;
- relevant transaction/position evidence where applicable;
- explicit audited resume/rollback decision.
