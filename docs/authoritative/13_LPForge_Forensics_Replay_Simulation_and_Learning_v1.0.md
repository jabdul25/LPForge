> **Project:** LPForge  
> **Suite Version:** 1.0  
> **Design Baseline Date:** 12 August 2026  
> **Status:** Build-guiding baseline  
> **Scope:** Meteora DLMM liquidity intelligence, decisioning, simulation, execution and operations  
> **Principle:** Protocol truth is observed; trading intelligence is inferred; execution is deterministic.  


# LPForge Forensics, Replay, Simulation and Learning Framework

## 1. Purpose

LPForge improves through evidence, not live patching.

The research framework must answer not only “did this trade win?” but:
- why;
- which component created/destroyed value;
- what alternative decisions were available;
- whether the result generalizes.

## 2. Three Simulation Levels

### Level 1 — Signal replay
Recompute features/intelligence exactly as known at historical time T.

Purpose: detect lookahead and decision quality.

### Level 2 — Bin-aware LP simulator
Reconstruct position composition and fee attribution through observed swaps/bins.

Purpose: realistic LP economics.

### Level 3 — Execution-aware simulator
Include:
- composition fees;
- transaction/priority fees;
- rent where economically relevant;
- slippage;
- rebalance cost;
- latency/state drift assumptions.

Purpose: estimate live realizability.

## 3. Simulator Fidelity Rule

Do not use:

```text
pool fee/TVL × our capital
```

as the final simulated fee model.

When data permits, allocate fees according to:
- bins crossed;
- candidate liquidity in those bins;
- competing liquidity;
- MM fee component;
- fee mode;
- position share.

## 4. Episode Record

Every considered opportunity receives an episode even if no trade occurs.

Episode contains:
- factual market timeline;
- assessments;
- `NO_TRADE`/entry decision;
- range candidates;
- execution;
- position evolution;
- result attribution;
- counterfactuals.

This allows measurement of missed opportunities as well as avoided losses.

## 5. PnL Attribution

At minimum:
- gross swap fees;
- rewards;
- price/inventory PnL;
- HODL-relative divergence;
- composition fees;
- swaps/slippage;
- transaction fees;
- rebalance benefit/cost;
- missed fee due to OOR;
- final residual inventory.

## 6. Required Counterfactuals

For entered positions:
- no trade;
- delayed entry;
- earlier entry where data valid;
- narrower/wider ranges;
- Spot/Curve/BidAsk alternatives;
- hold vs actual rebalance;
- earlier exit;
- no-rebalance;
- alternative management timing.

For rejected opportunities:
- enter with best plausible candidate;
- result after configured horizon.

## 7. Experiment Design

Each experiment declares:
- hypothesis before run;
- treatment;
- frozen control;
- evaluation window;
- primary metric;
- secondary risk metrics;
- acceptable degradation;
- sample/coverage requirements.

Do not choose the metric after seeing the result.

## 8. Chronological Validation

Use:
- training/research window;
- validation window;
- untouched test window;
- walk-forward evaluation.

Avoid random row shuffling for temporal market problems.

## 9. Leakage Prevention

Features at T may only use data:
- chain-observed by T;
- external-observed by T;
- available under the actual production latency model.

Backfilled perfect candles cannot be treated as if they were known before close.

## 10. Overfitting Controls

- minimize free thresholds;
- group related features;
- retain control cohorts;
- require multiple market regimes;
- report parameter sensitivity;
- reject fragile optimums;
- prefer broad plateaus over one best setting;
- evaluate costs under stressed assumptions.

## 11. Policy Promotion

Research creates a candidate policy:
`DRAFT -> RESEARCH -> SHADOW -> PAPER -> LIMITED_LIVE -> PRODUCTION`

Promotion requires Document 15 evidence.

No automated optimizer can directly set `PRODUCTION`.

## 12. Model Monitoring

For probabilistic models:
- calibration;
- drift;
- feature distribution shift;
- regime confusion;
- survival forecast error;
- economic forecast error.

If calibration degrades materially, policy can automatically fall back to a simpler conservative policy.

## 13. Golden Episodes

Maintain a curated corpus of:
- fee-rich successful ranges;
- one-way directional loss;
- freefall;
- false pullback;
- controlled pullback;
- breakout retest;
- sudden liquidity removal;
- API/RPC gap;
- OOR and return;
- rebalance success/failure.

Every strategy-affecting code change replays them.

## 14. Acceptance Criteria

A result is research-grade only if another run using the same:
- raw dataset hash;
- code commit;
- feature version;
- policy;
- simulator version

produces the same decisions and accounting within documented numeric tolerances.
