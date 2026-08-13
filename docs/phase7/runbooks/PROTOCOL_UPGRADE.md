# Meteora protocol/SDK compatibility change

**Runbook ID:** `PROTOCOL_UPGRADE`

## Procedure

1. Pause all new entries and non-emergency writes.
2. Verify program ID, IDL/event decoding, PositionV2 layout and pinned SDK compatibility.
3. Run golden vectors plus local Meteora lifecycle.
4. Require explicit policy/release evidence before re-enabling writes.

## Exit evidence

- incident/control audit ID;
- health assessment;
- reconciliation status;
- relevant transaction/position evidence where applicable;
- explicit audited resume/rollback decision.
