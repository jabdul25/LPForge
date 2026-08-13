# LPForge Phase 1–6 v1.0.4 Event Decoder Hardening

This cumulative correction preserves all Phase 1–6 strategy, RangeForge, entry, risk, execution, signer, reconciliation, RPC hardening, canonical-asset policy, and canary-capital semantics from v1.0.3.

## Correction

The live operational collector could terminate an entire forward cycle when an Anchor/Meteora event candidate contained a short, malformed, unsupported, or nested-program `Program data:` payload. The observed production failure was a Node `RangeError [ERR_OUT_OF_RANGE]` inside Anchor `BorshEventCoder.decode`.

v1.0.4 hardens the read-only event-ingestion boundary by:

- scoping `Program data:` extraction to the active Meteora program invocation stack, so nested Token/System/other program data is not passed to the Meteora event coder;
- decoding each candidate independently;
- quarantining decoder failures as structured `LPFORGE_METEORA_EVENT_DECODE_QUARANTINED` warnings instead of terminating the whole operational cycle;
- preserving pool address, transaction signature, optional slot, payload length, error name, and error message in warning evidence;
- continuing to persist valid swap events from the same or later transactions.

This is an ingestion reliability correction only. It does not change regime classification, opportunity economics, RangeForge, entry timing, risk policy, execution authority, signer behavior, reconciliation, or the 0.02 SOL canary cap.

## Regression coverage

- nested non-Meteora `Program data:` is ignored;
- Meteora CPI event data is still recognized;
- the observed `ERR_OUT_OF_RANGE` decoder failure becomes non-fatal quarantine evidence;
- the full Phase 1–6 test/boundary/migration suite remains green;
- the real local Meteora OPEN → swap → CLOSE lifecycle remains green.

No live signing, submission, or mainnet transaction was performed during this correction.
