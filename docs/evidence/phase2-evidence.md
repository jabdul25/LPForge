# LPForge Phase 2 Evidence Pack

**Baseline:** 12 August 2026  
**Status:** PASS-WITH-ENVIRONMENT-OPEN-ITEMS

## Local implementation evidence

- Phase 1 implementation retained and extended, not replaced.
- Strict TypeScript compilation: PASS in current build environment.
- Automated tests: **32/32 PASS** at evidence capture.
- Phase 1 boundary scan: PASS.
- Phase 2 boundary scan: PASS.
- Migrations M0001–M0008 static validation: PASS.
- Fixture lab report: PASS.
- No signer/private key/transaction-send path added.

## Implemented P2 components

- M0007/M0008 research schema.
- Meteora protocol fee/liquidity/composition integer math.
- Actual-position forensics.
- Synthetic bin-share replay.
- Swap2Evt path fee attribution with fidelity warning.
- Range active/OOR/revisit analytics.
- Historical volume/fee API support.
- Sustainability metrics.
- Token/pool risk mapping.
- Toxic-flow estimate.
- Explainable research pool assessment.
- Economics summary.
- Chronological split and lookahead guard.
- Experiment hash/comparison.
- Counterfactual runner.
- Lab fixture/live-pool commands.
- Phase 2 read-only capabilities.

## Environment evidence still required on target VPS

- Install frozen project dependencies using Node 24/pnpm package baseline.
- Generate/commit lockfile if not already present.
- Apply M0001–M0008 to a blank PostgreSQL 17 database.
- Run migration process twice to prove idempotent deployment behavior where applicable.
- Verify current Meteora SDK/program compatibility.
- Run `live-pool` against at least three current pools, including one obviously weak/high-risk pool if safely observable.
- Accumulate collector swap/bin history and rerun pool assessment with real movement/flow history.
- Capture at least one real `PositionV2` timeline for `ONCHAIN_POSITION` forensic validation if a read-only public/example position is available.

## Exit decision

`PASS-WITH-ENVIRONMENT-OPEN-ITEMS`

Reason: research implementation is locally coherent and regression-tested; target-host dependencies, PostgreSQL and live Solana/Meteora evidence are not available in this container and therefore are not fabricated.

## Read-only API smoke evidence

- `GET /api/v1/capabilities` returned `phase=P2`, `readOnly=true`, `liveSigning=false` and the expected research capability list.
- `POST /api/v1/capabilities` returned HTTP 405 with `LPFORGE_PHASE2_READ_ONLY`.
