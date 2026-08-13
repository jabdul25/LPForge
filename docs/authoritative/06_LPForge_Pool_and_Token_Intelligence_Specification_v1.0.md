> **Project:** LPForge  
> **Suite Version:** 1.0  
> **Design Baseline Date:** 12 August 2026  
> **Status:** Build-guiding baseline  
> **Scope:** Meteora DLMM liquidity intelligence, decisioning, simulation, execution and operations  
> **Principle:** Protocol truth is observed; trading intelligence is inferred; execution is deterministic.  


# LPForge Pool and Token Intelligence Specification

## 1. Mission

Answer:

> Is this pool structurally suitable for LP capital, independently of whether the current entry timing is attractive?

Pool quality and entry timing must not be conflated.

## 2. Output

```json
{
  "eligibility": "ELIGIBLE|WATCH|BLOCK",
  "pool_quality_score": 0,
  "economic_quality_score": 0,
  "flow_quality_score": 0,
  "token_risk_score": 0,
  "data_quality": "GOOD|DEGRADED|BAD",
  "blockers": [],
  "evidence": {}
}
```

Scores explain; hard blockers govern.

## 3. Layer A — Protocol Validity

Block when:
- unsupported/malformed pool;
- disabled pool;
- unexpected function type for requested strategy;
- incompatible token program/extension;
- protocol compatibility hold;
- stale critical pool state;
- invalid reference-price relationship.

## 4. Layer B — Token Risk

Features:
- freeze authority;
- mint authority;
- verification status;
- blacklist/risk warnings;
- token age;
- holders;
- concentration;
- dev/creator concentration when sourced;
- liquidity trend;
- organic activity score where sourced;
- abnormal mint/supply behavior.

Risk provider failure is not automatically “safe.” Apply provider-failure policy.

## 5. Layer C — Liquidity Quality

Do not use TVL alone.

Measure:
- total TVL;
- local liquidity within ±N bins;
- local liquidity / TVL;
- active-bin depth;
- empty-bin gaps;
- liquidity cliffs;
- X/Y imbalance;
- persistence of liquidity through time;
- sudden liquidity withdrawal;
- concentration in a small number of bins.

A pool with high TVL far from the current price can be less useful to an active LP than a smaller pool with deep local liquidity.

## 6. Layer D — Fee Economics

Measure per horizon:
- fees;
- fee/TVL;
- fee/local-liquidity;
- MM fee component;
- dynamic fee;
- base fee;
- fee persistence;
- fee burstiness;
- fee trend;
- protocol share;
- fee denomination mode.

Critical distinction:

```text
high fees + one-way toxic flow ≠ good LP economics
```

## 7. Layer E — Flow Quality / Toxicity

Candidate signals:
- directional swap imbalance;
- continuous active-bin traversal in one direction;
- low active-bin revisit rate;
- volume dominated by few large swaps;
- large inventory conversion per unit fee;
- increasing bin velocity;
- falling local liquidity while volume remains high;
- repeated OOR-like excursions for hypothetical ranges.

Produce `toxicity_probability` and reason codes; do not reduce all behavior to one score.

## 8. Layer F — Sustainability

A pool should be assessed for persistence:
- fee generation present in multiple windows;
- volume persistence;
- liquidity persistence;
- token risk stability;
- no recent structural break.

Use windows such as 30m/1h/2h/4h/12h/24h, but policy owns the exact requirements.

## 9. Pool Archetypes

Classify descriptive archetypes:
- `MATURE_DEEP`
- `MATURE_VOLATILE`
- `NEW_HIGH_ACTIVITY`
- `BURSTY_SPECULATIVE`
- `THIN_TRENDING`
- `LIQUIDITY_DECAY`
- `REWARD_DRIVEN`
- `LIMIT_ORDER_HEAVY`
- `UNKNOWN`

Archetype influences which policies are eligible; it does not automatically trade.

## 10. Pool Economics Forecast

Estimate horizon-specific:
- expected MM fees attributable to candidate liquidity;
- expected active time;
- expected inventory conversion;
- expected adverse-flow loss;
- expected rewards;
- uncertainty.

The estimate must be based on **candidate range/local liquidity**, not simply `capital / TVL`.

## 11. Hard Safety Block Examples

Policy-configurable but structurally supported:
- freeze authority enabled where policy disallows it;
- token/pool blacklisted;
- reference price stale;
- pool/reference divergence excessive;
- liquidity-collapse event;
- data gaps around current activity;
- pool disabled;
- unsupported Token-2022 behavior;
- risk budget exhausted.

## 12. Anti-Overfitting Rule

Pool eligibility thresholds must first be motivated by a failure mechanism, then tested on unseen chronological periods. Do not optimize dozens of thresholds solely to maximize historical return.

## 13. Acceptance Criteria

The engine must be able to explain:
- why a high-fee pool was blocked;
- why a low-TVL pool could still qualify;
- whether fee quality is persistent or spike-driven;
- whether flow is two-way or inventory-toxic;
- which exact source facts produced each blocker.
