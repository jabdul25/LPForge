# LPForge Phase 3 Implementation Package v1.0

**Boundary:** Phase 3 predicts and recommends only. It does not build, sign or send transactions and does not automatically enter, rebalance, claim, swap or exit.

## Objective
Transform Phase 1 protocol truth and Phase 2 LP economics into auditable, shadow-only LP recommendations where `NO_TRADE` competes directly with every generated Meteora range candidate.

## Implemented stages
P3-01 through P3-16 are implemented in the repository and governed by `PHASE_3_SEQUENCE.md`.

## Primary packages
- `market-context`: synchronized 5m/15m/30m/1h/4h context without lookahead.
- `structure-features`: trend, impulse, retracement, compression/expansion, support/reclaim, flow/liquidity evidence.
- `regime`: probabilistic regime classification plus continuity/transition analysis.
- `setup-specialists`: controlled-pullback and breakout-pullback validation.
- `opportunity`: net LP economics and opportunity state machine.
- `range-survival`: empirical survival/first-passage/revisit forecasts fitted only through cutoff.
- `rangeforge`: volatility-conditioned range geometry and Spot/Curve/BidAsk candidate generation.
- `candidate-simulator`: Phase 2 bin-aware replay for each candidate.
- `candidate-ranking`: risk-adjusted ranking with explicit `NO_TRADE` competitor.
- `thesis`: deterministic machine-readable LP thesis with invalidation contract.
- `shadow`: end-to-end no-signing recommendation runtime.
- `evaluation`: calibration, regime confusion, false-positive and missed-opportunity reports.

## Phase 3 exit rule
Phase 3 exits only if the full P1/P2/P3 regression suite, strict typecheck/build, migration checks, boundary checks and fixture shadow run are green. Live-market predictive usefulness remains a VPS shadow-evidence gate and must not be inferred from fixtures.
