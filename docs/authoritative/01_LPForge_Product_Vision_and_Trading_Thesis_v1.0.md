> **Project:** LPForge  
> **Suite Version:** 1.0  
> **Design Baseline Date:** 12 August 2026  
> **Status:** Build-guiding baseline  
> **Scope:** Meteora DLMM liquidity intelligence, decisioning, simulation, execution and operations  
> **Principle:** Protocol truth is observed; trading intelligence is inferred; execution is deterministic.  


# LPForge Product Vision and Trading Thesis

## 1. Product Definition

LPForge is an autonomous decision-support and execution platform for Meteora DLMM liquidity provision. Its purpose is to deploy capital only when the expected value of providing liquidity is superior to remaining undeployed under the configured risk budget.

The product is built around **liquidity intelligence**, not directional prediction alone.

## 2. Core Economic Thesis

A DLMM LP position is economically attractive only when expected compensation from fees and eligible rewards exceeds:

- adverse inventory conversion;
- divergence from the configured hold benchmark;
- range inactivity;
- composition fees;
- transaction and priority fees;
- swap/slippage cost required for rebalancing;
- opportunity cost;
- tail-risk charge.

Therefore the core optimization target is not “maximize fees.”

### 2.1 Primary objective

For horizon `H`:

```text
Expected Net LP Value(H)
  = Expected Trading Fee Value(H)
  + Expected Reward Value(H)
  + Expected Inventory Mark-to-Market Change(H)
  - Expected Benchmark Opportunity Cost(H)
  - Expected Composition/Rebalance Cost(H)
  - Expected Transaction/Swap Cost(H)
  - Expected Tail-Risk Charge(H)
```

For a SOL-numeraire strategy, all components must also be expressed in SOL-equivalent units at observation time. USD PnL remains a secondary reporting lens.

### 2.2 Mandatory dual benchmark

Every episode reports at least:
- **absolute PnL**: final value minus contributed value;
- **HODL-relative PnL**: LP result minus value of simply holding the original assets;
- **numeraire result**: change in configured primary numeraire.

This prevents fee income from masking destructive inventory conversion.

## 3. Product Goals

LPForge should:

1. Discover structurally attractive Meteora DLMM pools.
2. Measure whether fee generation is sustainable rather than momentary.
3. Detect toxic one-way flow and adverse bin traversal.
4. Classify regime and price structure at multiple horizons.
5. Estimate range survival probability.
6. Construct multiple candidate DLMM positions.
7. choose a position only when expected risk-adjusted value is positive.
8. Manage the position as new evidence arrives.
9. preserve full forensic evidence for every decision.
10. improve through controlled experiments rather than live improvisation.

## 4. Explicit Non-Goals

LPForge v1 is not:
- a universal Solana trading bot;
- a token-launch sniper;
- a copy-trading system;
- a leverage/futures engine;
- a system that must always deploy capital;
- a black-box ML agent allowed to sign transactions;
- a fee-maximization system without inventory accounting.

## 5. Decision Hierarchy

A candidate must pass these layers in order:

```text
PROTOCOL_VALID
    ↓
TOKEN_SAFE_ENOUGH
    ↓
POOL_STRUCTURALLY_ELIGIBLE
    ↓
ECONOMICS_ATTRACTIVE
    ↓
REGIME_TRADABLE
    ↓
ENTRY_TIMING_VALID
    ↓
RANGE_PLAN_POSITIVE_EV
    ↓
RISK_GOVERNOR_APPROVED
    ↓
EXECUTION_PREFLIGHT_APPROVED
    ↓
ENTER
```

Failure at any layer produces a reason-coded `NO_TRADE`.

## 6. Intelligence Separation

The following questions must remain separate:

| Question | Engine |
|---|---|
| Is the token/pool acceptable? | Pool & Token Intelligence |
| What is the market doing? | Regime & Structure |
| Is there an opportunity? | Opportunity Engine |
| Is now the correct deployment moment? | Entry Engine |
| What position should express it? | RangeForge |
| Should the existing position change? | Position Intelligence |
| Is the action allowed? | Risk Governor |
| How is it executed? | Execution Engine |

No single score should replace these distinct judgments.

## 7. Expected Edge Families

LPForge should investigate multiple independent edge families:

### Fee persistence edge
Pools where fee generation persists relative to useful local liquidity.

### Range-survival edge
Conditions where price spends enough time inside a selected band for fees to compound faster than adverse inventory effects.

### Mean-reversion edge
Structured environments where temporary movement is likely to revisit high-liquidity zones.

### Volatility-compensation edge
Periods where Meteora's volatility-aware fee rises enough to compensate for additional inventory risk.

### Liquidity-structure edge
Bin distributions where local depth, gaps, imbalance or active-bin behavior create measurable LP advantages.

### Flow-quality edge
Trading dominated by two-way organic activity rather than one-directional liquidation/distribution.

### Position-management edge
Value created by intelligent hold/reshape/rebalance/exit decisions rather than entry alone.

No edge is assumed valid until the evidence framework confirms it.

## 8. Opportunity Classes

The domain supports at least:

- `CALM_MEAN_REVERSION_LP`
- `SIDEWAYS_FEE_HARVEST`
- `CONSOLIDATION_LP`
- `CONTROLLED_PULLBACK_LP`
- `BREAKOUT_PULLBACK_LP`
- `VOLATILITY_CAPTURE_LP`
- `DCA_ENTRY_LP`
- `DCA_EXIT_LP`
- `DEFENSIVE_WIDE_LP`

These are hypotheses/classes, not automatic entry permissions.

## 9. Success Metrics

Top-level:
- net SOL-equivalent return;
- HODL-relative return;
- max drawdown;
- tail loss;
- realized fees / adverse inventory loss;
- live vs simulated execution drift.

Decision quality:
- `NO_TRADE` opportunity-cost distribution;
- entry-to-first-OOR time;
- range survival at 15m/30m/1h/2h/4h;
- fee capture per unit local active liquidity;
- percentage of positions whose realized result falls inside forecast bands;
- calibration of regime and survival probabilities.

Operational:
- event ingestion lag;
- missing-event rate;
- reconciliation mismatch rate;
- transaction failure rate;
- duplicate-action rate;
- RPC/API dependency health.

## 10. Product Principle

The target is not a bot that is “right” about price.

The target is a system that can demonstrate, before deploying capital, **why the liquidity position is expected to be paid enough for the risks it is taking**, and can detect when that proposition stops being true.
