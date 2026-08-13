# LPForge Phase 1 Local Verification

Date: 12 August 2026

## Build environment available here
- Node.js: v22.16.0 (verification host only; production baseline is Node 24.x LTS)
- TypeScript compiler available locally: 5.8.3
- pnpm: unavailable because this container cannot reach the npm registry
- PostgreSQL/psql: unavailable
- Docker: unavailable

## Passed locally

1. `tsc -p tsconfig.json --noEmit` — PASS
2. `tsc -p tsconfig.json` — PASS
3. `node --test tests/*.test.mjs` — PASS, 16/16
4. `node scripts/verify-phase1-boundary.mjs` — `PHASE1_BOUNDARY_OK`
5. `node scripts/verify-migrations.mjs` — PASS for M0001..M0006
6. Fixture feature/replay runtime — PASS
7. Read-only API smoke — PASS:
   - `GET /health/live` => UP / P1 / liveSigning=false
   - `GET /api/v1/capabilities` => readOnly=true
   - `POST /api/v1/capabilities` => HTTP 405 `LPFORGE_PHASE1_READ_ONLY`
8. Forced `LIVE_SIGNING=true` startup — correctly FAILS with `LPFORGE_PHASE1_LIVE_SIGNING_PROHIBITED`
9. Source scan for signer/transaction primitives in `apps/` and `packages/` — no live-signing/send primitive found.

## Unit coverage
- fixed-point token valuation;
- position gross value, absolute PnL, HODL-relative PnL;
- runtime config signing rejection;
- Data API pagination/page-size and schema boundary;
- bin local-liquidity features;
- two-way swap-flow features;
- deterministic feature content hash;
- SDK pool-shape normalization;
- Anchor `Program data:` extraction;
- PostgreSQL migration table coverage;
- Solana RPC scanner slot/log provenance.

## Target-host evidence still required
- generate and freeze `pnpm-lock.yaml` on a connected Node 24 host;
- install `@meteora-ag/dlmm@1.9.8`, `@solana/web3.js`, and `pg`;
- migrate a blank PostgreSQL 17 database and rerun migrations;
- live-read a current Meteora pool/active bin/bin window;
- live-read a known PositionV2;
- verify current `Swap2Evt` decoding on mainnet transaction(s);
- capture Data API live pool/OHLCV proof;
- archive target-host evidence in `docs/evidence/phase1-evidence.md`.

Until those environment-dependent checks pass, do not begin Phase 2 intelligence implementation.
