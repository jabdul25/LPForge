# LPForge Phase 1–6 v1.0.6 Temporal Ordering Hardened

This cumulative correction preserves all v1.0.5 live-evidence, valuation, execution-safety, signer-isolation, reconciliation, and canary controls.

## Root cause

The v1.0.5 live operator captured the cycle `observedAt`/decision time before RPC, Data API, and Swap2Evt ingestion completed. Newly decoded on-chain events correctly received a later ingestion `observedAt`, so the unchanged no-lookahead guard rejected them as future evidence with `LPFORGE_SHADOW_LOOKAHEAD_EVENT`.

## Corrections

- The live operator now records a separate `cycleStartedAt` for runtime telemetry.
- Pool and bin facts retain their actual adapter observation timestamps instead of being rewritten to the cycle start.
- Data API snapshots receive their own post-fetch observation timestamp.
- Swap2Evt events retain their ingestion observation timestamp.
- The operational `decisionAt` is captured only after all evidence for the cycle has been ingested and operational history has been loaded.
- Current pool/bin temporal validation now enforces the correct invariant, `fact.observedAt <= decisionAt`, rather than requiring timestamp equality.
- Genuine future pool, bin, market, active-bin, frame, and swap evidence remains a hard no-lookahead failure.
- Runtime heartbeats preserve both `cycleStartedAt` and the post-evidence decision timestamp.

## Validation

- 236/236 automated tests PASS.
- Phase 1–6 boundary verifiers PASS.
- M0001–M0018 static migration verification PASS.
- Real local Meteora OPEN → PositionV2 V2 → SWAP → CLOSE PASS.
- Real local Swap2Evt temporal proof PASS: exactly one event decoded, event ingestion timestamp <= decisionAt, futureEventCount=0.
- Explicit regression proves a swap event observed after decisionAt still fails with `LOOKAHEAD_EVENT`.
- No mainnet transaction was sent during implementation or validation.

Phase 6 operational promotion remains HOLD pending corrected v1.0.6 mainnet read-only evidence and the normal canary gates.
