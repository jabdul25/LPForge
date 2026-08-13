# LPForge Phase 1 Evidence Pack

Status is updated by the build/review process. Environment-dependent checks must not be marked PASS without evidence from the target host.

## 1. Build baseline
- Repository: `lpforge`
- Phase: 1 read-only foundation
- Node production baseline: 24.x LTS
- Meteora SDK baseline: 1.9.8
- DLMM release baseline: 0.12.0

## 2. Implemented work items
P1-01 through P1-14 implementation code is present. See `docs/implementation/PHASE1_BUILD_STATUS.md`.

## 3. Local artifact checks
- TypeScript typecheck: see `LOCAL_VERIFICATION.md` generated with release artifact.
- TypeScript build: see `LOCAL_VERIFICATION.md`.
- Unit/static tests: see `LOCAL_VERIFICATION.md`.
- Phase 1 no-signing boundary: see `LOCAL_VERIFICATION.md`.
- Migration static verification: see `LOCAL_VERIFICATION.md`.

## 4. Target-host checks required before Phase 1 exit is PASS
- [ ] `pnpm install --frozen-lockfile` on connected Node 24 environment after lockfile creation.
- [ ] blank PostgreSQL database migration proof.
- [ ] migration checksum/re-run proof.
- [ ] current `@meteora-ag/dlmm` compatibility import proof.
- [ ] live read-only known-pool `LbPair`/active-bin/bin-window proof.
- [ ] known `PositionV2` read proof.
- [ ] Data API pool/OHLCV smoke proof.
- [ ] event decoder proof against current mainnet `Swap2Evt` transaction.
- [ ] API health/readiness proof.
- [ ] no-signing boundary proof on deployed artifact.

## 5. Phase 1 exit classification
Until the target-host checks above are captured: **PASS-WITH-ENVIRONMENT-OPEN-ITEMS**.

Phase 2 intelligence must not start if protocol/accounting correctness is in HOLD.
