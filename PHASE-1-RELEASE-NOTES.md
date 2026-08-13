# LPForge Phase 1 Release Notes — v1.0

**Release:** `0.1.0-phase1`  
**Date:** 12 August 2026  
**Boundary:** read-only Meteora DLMM foundation; no wallet/signing/trading decisions.

## Delivered

- P1-01 repository/workspace, strict TypeScript and CI baseline.
- P1-02 typed configuration with hard signing/secret-material rejection.
- P1-03 six PostgreSQL migrations covering protocol, market, features, accounting and ingestion checkpoints.
- P1-04 structured logging, request IDs and evidence/runbook foundation.
- P1-05 current Meteora SDK/program compatibility probe.
- P1-06 `LbPair`, active-bin and bin-window reads through the official SDK integration seam.
- P1-07 `PositionV2` read/normalization path.
- P1-08 centralized Meteora Data API client with <=30 RPS limiter, pools and OHLCV.
- P1-09 Solana JSON-RPC transaction scan, Anchor program-data extraction, SDK event decoding seam, idempotent swap-event persistence and checkpoints.
- P1-10 source/slot/block/source-observed/processed time provenance model.
- P1-11 deterministic bin-window, active-bin movement, swap-flow and fee-quality feature primitives with content hashes.
- P1-12 fixed-point token/position valuation with fees, contributed value and HODL-relative PnL primitives.
- P1-13 read-only inspection API and CLI, health/readiness, deployment runbook.
- P1-14 automated tests, boundary verification, migration static verification and evidence pack.

## Local verification

See `LOCAL_VERIFICATION.md`. The source typechecks and builds; 16 tests pass; runtime API and no-signing checks pass.

## Environment-open evidence

This build environment has no package-registry network, PostgreSQL binary/server, or Docker. Therefore the pinned Meteora SDK and PostgreSQL migrations could not be executed live here. The release is classified `PASS-WITH-ENVIRONMENT-OPEN-ITEMS` until the provided deployment prompt is executed on the target VPS.

## Phase 2 remains out of scope

No Pool Intelligence, regime classifier, opportunity/entry engine, RangeForge, risk-capital strategy, wallet signer, rebalance, claim, swap, or transaction send path is present.
