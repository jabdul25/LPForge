# LPForge Phase 4 Runtime Verification v1.0.2

**Date:** 2026-08-12  
**Result:** PASS-WITH-LIVE-METEORA-AND-FORWARD-SHADOW-PENDING

## Runtime proven in sandbox

- Node.js 24.19.0: PASS
- pnpm 11.21.0: PASS
- Frozen dependency graph: 168 packages
- `@meteora-ag/dlmm` 1.9.8: installed
- `@solana/web3.js` 1.98.4: installed
- `pg` 8.16.3: installed
- TypeScript 6.0.3: installed
- Offline dependency installation: PASS
- strict TypeScript typecheck: PASS
- TypeScript build: PASS
- automated tests: 114/114 PASS
- Phase 1/2/3/4 boundary scans: PASS

## PostgreSQL proven

- PostgreSQL 17.10 standalone runtime: PASS
- actual Node `pg` migration path: PASS
- M0001 through M0011: PASS
- resulting LPForge tables: 32
- protocol/market/feature/accounting/research persistence contract: PASS
- duplicate-bin idempotency: PASS
- DB guard/constraint checks: PASS

## Phase 4 persistence defect found and fixed

M0010 defined paper-management evidence tables, but the Phase 4 paper application had no persistence seam and `createPostgresStore` exposed none of the M0010 write methods. This was treated as a runtime integration defect.

The patch adds PostgreSQL store methods for:

- entry evaluations;
- risk decisions;
- paper positions;
- paper position events;
- management decisions;
- capital allocations;
- paper portfolio snapshots.

`apps/paper` now has an explicit `fixture-once-persist` path that runs the paper management cycle and persists its evidence via the actual Node `pg` adapter. No live/on-chain action path was added.

## M0011 idempotency guards

M0011 adds unique replay guards for:

- `(paper_position_id, observed_at, event_type)` on paper position events;
- `(portfolio_id, observed_at)` on paper portfolio snapshots.

Replaying the same Phase 4 fixture observation twice produced:

- paper positions: 1
- management-cycle events: 1
- management decisions: 1

The persisted decision was `RESHAPE`, with forward EV `0.008` for the fixture evidence.

## Dependency-security note

The bundle's file manifest contained absolute VPS paths. Those paths were normalized only for relocation verification; all 4,677 bundled files then passed checksum validation. The release retains a frozen `pnpm-lock.yaml` and explicitly approves build scripts only for `bigint-buffer`, `bufferutil`, and `utf-8-validate`. The sandbox temporarily trusted the already-generated lockfile because registry metadata was unavailable offline; that override is not committed to the release.

## Remaining environment boundary

Live external reads could not be proven in this sandbox:

- Meteora Data API DNS: `EAI_AGAIN`
- public Solana RPC: network timeout

Therefore the remaining validation is live read-only Solana/Meteora testing and sustained forward shadow/paper operation on a connected host.
