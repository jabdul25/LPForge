# LPForge Phase 6 Signer / Simulation Correction v1.0.1

This correction was produced after the first connected mainnet build+simulate evidence on 2026-08-12.

## Corrected issues

1. Phase 6 OPEN now supports the exact required signer set for Meteora `initializePositionAndAddLiquidityByStrategy`: owner plus an ephemeral in-memory PositionV2 account signer.
2. Submission is blocked if any required signer backend is missing or if an unexpected signer backend is supplied.
3. The auxiliary PositionV2 signer is cluster-locked to the Phase 6 mainnet canary authority, purpose-bound to `POSITION_ACCOUNT`, non-exportable, and not reused for CLOSE.
4. The manual no-send simulation evidence aggregation issue is documented: `signingPerformed=false` and `submissionPerformed=false` are required safety facts and must not be evaluated as failed boolean checks.

## Validation

- 212/212 Node tests PASS.
- P1-P6 boundary scanners PASS.
- M0001-M0018 static lineage PASS.
- Real local Meteora rehearsal PASS using the Phase 6 dual-signer abstraction: owner + ephemeral PositionV2 signer -> simulate -> submit to local validator -> PositionV2 -> close.
- No mainnet transaction was sent during this correction.
