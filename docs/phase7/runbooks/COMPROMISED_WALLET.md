# Suspected compromised wallet

**Runbook ID:** `COMPROMISED_WALLET`

## Procedure

1. Activate manual emergency and pause non-emergency writes.
2. Isolate signer credentials and rotate provider/API credentials as applicable.
3. Inventory all positions, pending signatures and wallet balances.
4. Use the approved emergency-close workflow only if safer than holding.
5. Do not include secrets in incident bundles.

## Exit evidence

- incident/control audit ID;
- health assessment;
- reconciliation status;
- relevant transaction/position evidence where applicable;
- explicit audited resume/rollback decision.
