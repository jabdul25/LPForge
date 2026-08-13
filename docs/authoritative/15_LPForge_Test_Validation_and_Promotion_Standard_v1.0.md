> **Project:** LPForge  
> **Suite Version:** 1.0  
> **Design Baseline Date:** 12 August 2026  
> **Status:** Build-guiding baseline  
> **Scope:** Meteora DLMM liquidity intelligence, decisioning, simulation, execution and operations  
> **Principle:** Protocol truth is observed; trading intelligence is inferred; execution is deterministic.  


# LPForge Test, Validation and Promotion Standard

## 1. Purpose

Define when software is correct enough to run and when a policy is evidenced enough to receive capital.

## 2. Test Pyramid

### Unit
- bin/price conversion;
- fixed-point handling;
- fee accounting;
- feature calculations;
- state transitions;
- reason codes;
- risk rules.

### Contract
- Meteora SDK method contracts;
- IDL/event decoders;
- Data API schema;
- external adapters.

### Integration
- PostgreSQL;
- collector restart;
- decision-to-plan;
- plan-to-simulation;
- reconciliation.

### Replay
- golden episodes;
- historical windows;
- protocol-version fixtures.

### Devnet/sandbox where appropriate
- position creation;
- add/remove;
- claim;
- rebalance;
- error paths.

### Mainnet read-only
- decoding known pools/positions;
- event parity;
- Data API cross-check.

### Limited live
Only after all previous gates.

## 3. Accounting Invariants

Tests must prove:
- claimed + unclaimed fees not double counted;
- deposits/withdrawals reconcile;
- HODL benchmark uses original inventory correctly;
- residual wallet token value included;
- failed tx does not mutate economic state;
- partial workflows are represented accurately.

## 4. Protocol Golden Vectors

Pin fixtures for:
- bin prices;
- strategy weights;
- fee calculations;
- `Swap2Evt` parsing;
- `Rebalancing` parsing;
- PositionV2 decoding;
- wide position;
- Token-2022 supported case.

Compare LPForge output to official SDK/program behavior.

## 5. Strategy Promotion Gates

### Research
Must show hypothesis and reproducible offline result.

### Shadow
Runs against current market without signing. Verify:
- decisions are timely;
- no stale-data actions;
- forecasts captured before outcomes;
- system stability.

### Paper
Execution-aware virtual ledger:
- realistic fills/state drift;
- complete accounting;
- no hindsight.

### Limited live
Small capped capital:
- risk limits much tighter than planned production;
- no automatic scale-up;
- execution drift measured.

### Production
Requires stable limited-live behavior and an approved evidence bundle.

## 6. Evidence Bundle

A promotion bundle contains:
- policy diff;
- code commit;
- feature schema;
- dataset hashes;
- experiment report;
- walk-forward results;
- stress results;
- shadow report;
- paper report;
- live report if applicable;
- known limitations;
- rollback target.

## 7. Required Metrics

Return:
- net;
- numeraire;
- HODL-relative.

Risk:
- max drawdown;
- tail quantiles/CVaR;
- worst episode;
- inventory exposure.

LP mechanics:
- fee capture;
- OOR frequency/duration;
- range active-time;
- rebalance frequency/cost.

Forecast:
- survival calibration;
- regime calibration;
- net-value forecast error.

Operational:
- failure/reconciliation rate.

## 8. No Single-Metric Promotion

A policy cannot be promoted because:
- win rate increased;
- gross fees increased;
- backtest profit increased.

It must preserve risk and operational criteria.

## 9. Regression Standard

Every production change runs:
- unit/contract/integration;
- golden episodes;
- representative historical replay;
- strategy-decision diff.

Unexpected decision differences require explanation.

## 10. Freeze Rule

When a version enters limited live, its decision policy is frozen. Fixes to correctness may be patched with explicit versioning; strategy tuning creates a new candidate cohort.

## 11. Acceptance Definition

“Built” means:
- code exists;
- tests pass;
- observability exists;
- failure behavior is known;
- reconciliation works;
- evidence is stored.

“Profitable in backtest” does not mean built or safe to scale.
