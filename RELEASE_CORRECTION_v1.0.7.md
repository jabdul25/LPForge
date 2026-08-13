# LPForge Release Correction v1.0.7 — Regime History Persistence

## Purpose

v1.0.6 proved live Swap2Evt ingestion, capital-normalized RangeForge valuation, temporal ordering, and correct global economic vetoes. Mainnet read-only evidence also exposed that `regimeHistory.samples` remained `1` on each live cycle because previously persisted regime assessments were not loaded back into the operational runtime.

v1.0.7 corrects that persistence gap without weakening any no-lookahead or execution safety boundary.

## Changes

- Added bounded PostgreSQL loading of prior `research.regime_assessments` for the same pool.
- Prior regime rows are selected strictly before the new cycle `decisionAt` and returned in chronological order.
- Live operator loads up to 120 prior regime assessments and passes them into the existing Phase 3 shadow classifier.
- Added the minimal `RegimeHistorySample` contract required for historical stability analysis so existing v1.0.6 rows remain compatible.
- Shadow runtime rejects invalid prior-regime timestamps and any prior regime observed after `decisionAt`.
- Newly persisted regime assessments retain richer audit evidence (`reasonCodes`, `rawScores`, and feature evidence).
- No signing, transaction submission, risk, capital, RangeForge valuation, Swap2Evt, or canary authority semantics were relaxed.

## Validation

- 240/240 tests PASS.
- Phase 1–6 boundary checks PASS.
- M0001–M0018 static migration verification PASS.
- Real local Meteora OPEN → PositionV2 → SWAP → CLOSE PASS; no mainnet transaction sent.
- Disposable PostgreSQL proof PASS: strictly-prior rows load chronologically and a row exactly at the decision cutoff is excluded.
- Regression proves regime history grows across cycles and stable duration accumulates.
- Regression proves a future persisted regime still hard-fails with `LPFORGE_SHADOW_LOOKAHEAD_REGIME`.

## Operational status

Phase 6 remains controlled-canary only. Production authority and autonomous scaling remain disabled. A fresh mainnet read-only cycle is required before any canary authority can be considered.
