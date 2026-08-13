# LPForge Pool Discovery D1/D2 Implementation Report

Baseline repository HEAD before discovery work: `43ff109b3a8de13e0e920031f9b1028d737f1d66`.

## Implemented

- New `packages/pool-discovery` package.
- New standalone `apps/discovery` daemon/CLI.
- `MANUAL`, `AUTO`, and `HYBRID` source modes.
- Initial automatic universe restricted to WSOL-paired Meteora DLMM pools.
- Manual pools are always evaluated with priority but do not gain execution authority.
- Meteora Data API pagination with server-side `sort_by` / `filter_by` support.
- Cheap universe prefilter using blacklist, TVL and 24h activity before deeper local scoring.
- Cheap feature extraction for TVL, 30m/1h/24h volume, fees, fee/TVL, holder count, market cap and market-cap-relative ratios.
- Market-cap cohort and fragility penalty; market cap is contextual rather than a naive hard rejection threshold.
- Explicit evidence availability states for missing market cap, holders, windows and age.
- Deterministic observation-priority score and percentile ranking.
- Cheap-screen ranking does not declare pools `ACTIVE_CANDIDATE`; D3 deep screening must qualify them first.
- Bounded deep-screen queue with manual-pool priority.
- New PostgreSQL migration `M0030_pool_discovery_universe.sql`.
- Persistent discovery registry, append-only observations and per-cycle rankings.
- Staleness demotion for previously discovered pools not refreshed within policy TTL.
- `discovery:once`, `discovery:start`, `discovery:status` scripts.
- Explicit static discovery boundary preventing transaction-planner/signer/executor/live-dispatch imports or execution-plan creation.

## Authority boundary

This implementation is discovery-only. It cannot create an execution intent or transaction plan and has no signer or submission path.

D1/D2 answers: "Which pools deserve deeper LPForge observation?"

It does not answer: "Should LPForge deploy capital?"

## Validation

- TypeScript typecheck/build: PASS for the modified source tree.
- Discovery/Data API targeted tests: 10/10 PASS.
- Discovery execution-authority boundary: PASS.
- Migration static verification: PASS through M0030.
- `git diff --check`: PASS.

A broad `node --test tests/*.test.mjs` run in the local sandbox discovered 370 tests: 347 passed and 23 failed solely because the supplied `node_modules` is incomplete in this sandbox (`@coral-xyz/anchor` and `@noble/curves/ed25519` missing) and the sandbox is Node 22 rather than the repository-pinned Node 24.19. The new discovery tests are not among those failures.

## Not implemented yet — D3+

- On-chain protocol compatibility verification for the deep queue.
- Active/near-active bin liquidity geometry.
- Historical fee persistence beyond cheap API windows.
- Multi-pool Swap2Evt collection and two-way-flow/toxicity analysis.
- Slow Pool Quality and fast Current Opportunity models.
- Strategy-specific range-survival evaluation.
- Promotion from `PREFILTERED/OBSERVING` into `QUALIFIED/WATCHLIST/ACTIVE_CANDIDATE`.
- Production operator multi-pool candidate consumption.
- Prediction/outcome/control-cohort feedback ledger and governed learning.

Those remain D3–D8 and should build on the persisted D1/D2 universe rather than bypass it.
