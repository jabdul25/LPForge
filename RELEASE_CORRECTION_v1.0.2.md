# LPForge Phase 1–6 v1.0.2 RPC-Hardened Correction

This cumulative correction preserves all Phase 1–6 strategy, risk, execution, signer, and canary semantics from v1.0.1 while hardening the read-only Solana RPC transport used by the live intelligence scanner.

Changes:
- pace scanner RPC requests with configurable `RPC_MIN_INTERVAL_MS` (default 125 ms);
- bounded retry for HTTP 429/500/502/503/504;
- honor `Retry-After` when provided;
- configurable retry budget/base/max delay;
- fail closed after the retry budget;
- add regression tests for 429 recovery, retry exhaustion, and pacing;
- standardize release integrity metadata on `RELEASE_MANIFEST.json`;
- make `SOURCE_REVISION.txt` verification accept the canonical raw 40-character revision format as well as the legacy key/value form.

No change:
- no strategy/regime/RangeForge threshold change;
- no risk-policy change;
- no signer-authority expansion;
- no canary-capital change;
- no autonomous scaling;
- no mainnet transaction performed during local validation.
