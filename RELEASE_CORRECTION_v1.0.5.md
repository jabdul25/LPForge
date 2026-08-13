# LPForge Phase 1–6 v1.0.5 Live Evidence & Valuation Hardening

This cumulative correction preserves all Phase 1–6 execution safety, signer isolation, reconciliation, canary controls, RPC hardening, canonical-asset policy, and event-decoder quarantine semantics from v1.0.4.

## Corrections

### 1. Real Meteora Swap2Evt ingestion

The live mainnet collector was scanning pool transactions but reported `history.swaps = 0` on an active SOL-USDC pool. Local protocol reproduction proved that current Meteora swaps emit their economically complete `Swap2Evt` through Anchor event CPI instruction data rather than `Program data:` logs.

v1.0.5 therefore:

- preserves Meteora self-CPI instruction data from `meta.innerInstructions` during RPC transaction scanning;
- resolves `programIdIndex` against static and loaded transaction account keys;
- strips the 8-byte Anchor CPI instruction discriminator and decodes the remaining event payload with the existing Anchor event coder;
- ingests only `Swap2Evt`, preventing the simultaneously emitted legacy `Swap` event from double-counting flow;
- preserves `from`, `mmFee`, `protocolFee`, `limitOrderFee`, `hostFee`, `feesOnInput`, and `feesOnTokenX` when present;
- keeps malformed/unsupported event payloads quarantined rather than terminating a cycle.

A real local Meteora swap produced zero Meteora `Program data:` event logs, two Meteora self-CPI payloads, and exactly one accepted `Swap2Evt` after the v1.0.5 filter. The decoded event contained the exact local swap amount and fee-side evidence.

### 2. PostgreSQL fee-side round-trip

`protocol.swap_events` already persisted `amount_left`, `fee_bps`, `fees_on_input`, and `fees_on_token_x`, but the operational history loader did not select/reconstruct those fields. v1.0.5 restores them during DB history reconstruction so later fee attribution retains the token side.

### 3. RangeForge valuation normalization

The live operational path previously combined:

- an arbitrary synthetic liquidity-share amount (`1000`), and
- hard-coded `1e-6` raw-unit values for both pool tokens.

That produced million-scale candidate values while the requested capital was only 0.02 SOL.

v1.0.5 replaces that with:

- explicit token-decimal-aware raw-unit calibration;
- token-X-denominated valuation, with canonical wSOL and USDC decimal fallbacks;
- Data API `current_price` as the primary Y-per-X reference price;
- capital normalization so the synthetic starting inventory is scaled to the candidate's requested capital;
- an explicit capital-relative sanity bound and `CANDIDATE_UNIT_SCALE_INVALID` evidence if the normalized path is implausible;
- `CANDIDATE_EVENT_PATH_NO_SWAP_EVIDENCE` when no decoded swap path exists.

### 4. Non-actionable RangeForge evidence cannot win

RangeForge may still calculate research rankings, but a candidate is no longer eligible to beat `NO_TRADE` when:

- unit calibration is invalid;
- event-path swap evidence is absent; or
- the independent aggregate economics layer says expected LP economics are non-positive.

This prevents `POSITIVE_RISK_ADJUSTED_CANDIDATE` from being surfaced as an actionable winner when the evidence beneath it is incomplete or economically negative.

## Validation

- 232/232 automated tests PASS.
- Phase 1–6 boundary verifiers PASS.
- M0001–M0018 static migration verification PASS.
- Real local Meteora OPEN → PositionV2 V2 → SWAP → CLOSE PASS.
- Real local swap event re-read through the new CPI path PASS.
- The real local event proof decoded exactly one `Swap2Evt` with `mmFee=400000`, `protocolFee=100000`, `feesOnInput=true`, and `feesOnTokenX=true`.
- No mainnet transaction was sent during implementation or validation.

Phase 6 operational promotion remains HOLD until corrected v1.0.5 live evidence is collected on mainnet and the normal intelligence gates produce a legitimate actionable decision.
