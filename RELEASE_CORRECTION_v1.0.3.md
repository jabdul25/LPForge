# LPForge Phase 1–6 v1.0.3 Canonical Asset Policy Correction

This cumulative correction preserves all Phase 1–6 strategy, RangeForge, entry, risk, execution, signer, reconciliation, RPC hardening, and canary-capital semantics from v1.0.2.

## Correction

The live Phase 6 operational cycle previously inherited the generic Phase 2 freeze-authority hard blocker. Canonical USDC therefore caused the exact approved SOL-USDC canary pool to be BLOCKED even though the pool and mint were explicitly approved.

v1.0.3 makes token mint identity explicit in pool intelligence and introduces a narrow Phase 6 canary policy exception bound to the exact tuple:

- pool: `5rCf1DM8LjKTw4YqhnoLcngyZYeNnQqztScTogYHAS6`
- canonical USDC mint: `EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v`
- reason: `CANONICAL_USDC_EXACT_POOL_ALLOWLIST`

The generic research policy remains strict. Symbols/names are never accepted as identity. The exception removes only the hard blocker; freeze-authority centralization risk remains visible in token-risk scoring and evidence.

## Regression coverage

- exact approved pool + canonical USDC mint consumes the exception;
- canonical USDC in another pool remains blocked;
- spoofed/unknown mint in the approved pool remains blocked;
- missing mint identity remains blocked;
- Data API normalization preserves mint identity;
- the live operational `evaluateOperationalCycle` path applies the Phase 6 canary policy;
- generic Phase 2 research policy remains strict.

No live signing, submission, or mainnet transaction was performed during this correction.
