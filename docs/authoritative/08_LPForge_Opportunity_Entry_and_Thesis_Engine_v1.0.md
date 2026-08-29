> **Project:** LPForge  
> **Suite Version:** 1.0  
> **Design Baseline Date:** 12 August 2026  
> **Status:** Build-guiding baseline  
> **Scope:** Meteora DLMM liquidity intelligence, decisioning, simulation, execution and operations  
> **Principle:** Protocol truth is observed; trading intelligence is inferred; execution is deterministic.  


# LPForge Opportunity, Entry and Thesis Engine

## 1. Mission

Convert pool quality + market regime + economics into an auditable decision about whether a deployable LP opportunity exists now.

## 2. Separation of Three Questions

### Opportunity
Is this environment capable of producing positive LP value?

### Entry
Is the current moment acceptable for deployment?

### Thesis
What exactly must happen for the position to remain justified?

These are stored separately.

## 3. Opportunity State Machine

```text
DISCOVERED
  -> SCREENED
  -> QUALIFIED
  -> WATCHING
  -> ARMED
  -> ENTRY_READY
  -> PLANNED
  -> ENTERED

Terminal/side states:
REJECTED
EXPIRED
INVALIDATED
CAPITAL_BLOCKED
DATA_BLOCKED
```

A candidate may move backward when conditions deteriorate.

## 4. Opportunity Economics

For every candidate class, forecast:
- horizon;
- expected active time;
- expected MM fee income;
- expected reward income;
- expected inventory conversion;
- expected HODL-relative loss/gain;
- expected execution/rebalance cost;
- downside quantiles;
- expected net LP value.

A minimum expected-value margin should include uncertainty; near-zero forecasts default to `NO_TRADE`.

## 5. Entry Timing

Entry should evaluate:
- regime stability;
- momentum direction;
- volatility trajectory;
- active-bin velocity;
- support/reclaim;
- pool-reference divergence;
- current dynamic-fee opportunity vs volatility risk;
- local-liquidity shape;
- expected immediate conversion;
- recent adverse transitions.

`GOOD_POOL` does not imply `ENTER_NOW`.

## 6. Entry Delay as a Candidate

RangeForge/Opportunity should compare:
- enter now;
- wait for one stabilization condition;
- wait for reclaim;
- no trade.

The system should measure whether waiting improved outcomes in historical counterfactuals.

## 7. Machine-Readable Thesis

Required structure:

```json
{
  "thesis_id": "uuid",
  "opportunity_class": "CONTROLLED_PULLBACK_LP",
  "numeraire": "SOL",
  "horizon_minutes": 120,
  "expected_regime": ["CONTROLLED_PULLBACK", "SIDEWAYS", "RECOVERY"],
  "forbidden_regimes": ["FREEFALL"],
  "expected_fee_value": "...",
  "expected_inventory_cost": "...",
  "expected_net_lp_value": "...",
  "expected_range_survival": {
    "30m": 0.91,
    "2h": 0.76
  },
  "invalidation": [
    "support_break",
    "bin_velocity_down_exceeds_policy",
    "liquidity_collapse",
    "reference_divergence_exceeds_policy",
    "forward_ev_non_positive"
  ],
  "review_at": ["5m", "15m", "30m"]
}
```

Values above are structural examples, not default thresholds.

## 8. Thesis Invalidation

Invalidation has levels:

### Soft deterioration
Decrease confidence; maybe widen or stop adding.

### Management trigger
Forward EV of current position is inferior to a viable alternative after costs.

### Hard invalidation
Original setup no longer exists; position must be reduced/closed subject to execution safety.

### Emergency
Risk Governor overrides normal management.

## 9. Evidence Bundle

Every `ENTRY_READY` decision stores:
- pool assessment ID;
- regime assessment ID;
- feature snapshot;
- policy;
- reference price;
- active bin;
- local liquidity window;
- forecast;
- candidate set;
- rejection reasons for alternatives.

## 10. Reason Codes

Examples:
- `POOL_ECONOMICS_WEAK`
- `FEE_SPIKE_NOT_PERSISTENT`
- `FLOW_TOO_DIRECTIONAL`
- `REGIME_UNSTABLE`
- `PULLBACK_NOT_MATURE`
- `REFERENCE_DIVERGENCE`
- `RANGE_SURVIVAL_TOO_LOW`
- `EXPECTED_NET_VALUE_NON_POSITIVE`
- `RISK_BUDGET_UNAVAILABLE`
- `DATA_STALE`

Reason codes are stable API contracts.

## 11. Expiry

An entry decision expires quickly enough that a materially changed active bin or reference price cannot reuse the old approval. Expiry is policy-driven and must be checked again by Execution.

## 12. Acceptance Criteria

For any planned position the system can answer:
- Why this pool?
- Why now?
- Why not ten minutes ago?
- Why this opportunity class?
- What outcome is expected?
- What observations would prove the thesis wrong?
