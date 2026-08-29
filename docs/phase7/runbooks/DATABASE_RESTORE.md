# PostgreSQL restore

**Runbook ID:** `DATABASE_RESTORE`

## Procedure

1. Pause all non-emergency writes before restore.
2. Verify encrypted/offsite backup and restore target.
3. Restore to isolated target first; verify migrations and integrity.
4. Run reconciliation against chain truth before production cutover.
5. Record achieved RPO/RTO and secret-scan support artifacts.

## Exit evidence

- incident/control audit ID;
- health assessment;
- reconciliation status;
- relevant transaction/position evidence where applicable;
- explicit audited resume/rollback decision.
