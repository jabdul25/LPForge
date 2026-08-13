> **Project:** LPForge  
> **Suite Version:** 1.0  
> **Design Baseline Date:** 12 August 2026  
> **Status:** Build-guiding baseline  
> **Scope:** Meteora DLMM liquidity intelligence, decisioning, simulation, execution and operations  
> **Principle:** Protocol truth is observed; trading intelligence is inferred; execution is deterministic.  


# RangeForge Range Construction and Capital Allocation Specification

## 1. Mission

RangeForge transforms a validated thesis into candidate DLMM position structures and chooses the best risk-adjusted expression.

It must never begin with “we use 50/65/100 bins.” Width is an output of the market, pool and horizon model.

## 2. Inputs

- pool protocol state;
- active bin and bin step;
- local bin liquidity;
- pool fee configuration;
- function/collect-fee mode;
- thesis;
- regime probabilities;
- volatility forecast;
- range-survival model;
- inventory-risk budget;
- available capital;
- execution/rent/compute estimates;
- policy constraints.

## 3. Candidate Dimensions

Generate candidates across:

### Strategy family
- Spot
- Curve
- BidAsk

### Orientation
- one-sided quote/numeraire;
- one-sided base/token;
- balanced;
- imbalanced/skewed.

### Range
- lower bin;
- upper bin;
- center/reference bin;
- asymmetry;
- width.

### Distribution
- strategy parameters;
- exact per-bin weights.

### Capital
- total;
- reserve capital;
- optional staged deployment;
- per-position cap.

## 4. Range as a Survival Problem

For candidate `C` and horizon `H`:

```text
P_active(C,H)
P_lower_exit(C,H)
P_upper_exit(C,H)
E_time_in_range(C,H)
E_first_passage_time(C)
```

A wider range is not automatically safer economically: it can dilute capital across bins and lower fee capture. A narrow range is not automatically superior: it can go inactive quickly.

## 5. Range as an Inventory Path

For each candidate simulate:
- expected token X/Y composition after upward path;
- expected composition after downward path;
- worst plausible conversion;
- value under hold benchmark;
- value after likely fee accrual.

This is essential for single-sided strategies: conversion into the volatile asset is an explicit risk state, not an implementation side effect.

## 6. Candidate Scoring

```text
Candidate Utility
  = E[Net LP Value]
  - λ1 * downside_CVaR
  - λ2 * OOR_probability
  - λ3 * rebalance_probability
  - λ4 * inventory_tail_risk
  - λ5 * execution_complexity
```

Weights are versioned policy, not constants in code.

## 7. Shape Selection Logic

Do not hard-map regime -> shape. Generate and compare candidates.

Reasonable priors:
- Curve tends to deserve consideration in calm/mean-reverting states.
- Spot provides simpler broad coverage.
- BidAsk deserves consideration for volatility/DCA-style structures.

The simulator/forecast chooses based on the actual thesis and pool.

## 8. Local Liquidity Competition

Fee capture depends on liquidity share in bins actually crossed. Candidate evaluation therefore uses:
- current per-bin competing liquidity;
- expected added liquidity;
- expected swap path;
- fee allocation.

Do not estimate candidate fees only from global TVL.

## 9. Bin Step Awareness

The same numeric bin width means different percentage coverage across pools.

RangeForge must compute:
- bin width;
- lower/upper percentage distance;
- absolute price boundaries;
- expected path in bin units.

Policy should reason primarily in bin-native units plus percentage reporting.

## 10. Dynamic Position Cost

Candidates wider than default storage may require:
- position extension;
- more bin arrays;
- bitmap extension;
- additional rent/compute.

`quoteCreatePosition`/`quoteExtendPosition` or equivalent current SDK functionality should inform execution-cost estimates before candidate ranking.

## 11. Staged Deployment

Optional candidate form:
- deploy tranche 1;
- add only if thesis strengthens;
- cancel remaining allocation if invalidated.

Staged deployment must be evaluated against additional transaction cost and missed-fee opportunity.

## 12. Capital Allocation

Global allocator receives candidate utilities from all pools and applies:
- wallet available balance;
- reserved SOL for transaction fees;
- maximum pool exposure;
- maximum token exposure;
- correlated exposure;
- daily risk budget;
- position count cap.

The best candidate can still receive zero capital.

## 13. Output

```json
{
  "candidate_id": "...",
  "strategy": "BID_ASK",
  "orientation": "ONE_SIDED_NUMERAIRE",
  "lower_bin": 0,
  "upper_bin": 0,
  "weights": [],
  "capital": "...",
  "expected_active_time": {},
  "expected_fee_value": {},
  "expected_inventory_path": {},
  "expected_net_lp_value": {},
  "cost_estimate": {},
  "stress": {},
  "expires_at": "..."
}
```

## 14. Stress Tests

Before selection:
- immediate lower break;
- immediate upper break;
- volatility doubles;
- fee decays;
- local liquidity doubles (fee dilution);
- local liquidity collapses;
- 1/5/10 large adverse swaps;
- reference price diverges;
- transaction/rebalance cost increases.

## 15. Acceptance Criteria

RangeForge must demonstrate:
- why chosen width beat narrower/wider candidates;
- why chosen shape beat Spot/Curve/BidAsk alternatives;
- expected fee share from actual local bins;
- inventory outcomes under both directions;
- costs of maintaining the range.
