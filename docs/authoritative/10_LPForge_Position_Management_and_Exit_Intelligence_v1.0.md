> **Project:** LPForge  
> **Suite Version:** 1.0  
> **Design Baseline Date:** 12 August 2026  
> **Status:** Build-guiding baseline  
> **Scope:** Meteora DLMM liquidity intelligence, decisioning, simulation, execution and operations  
> **Principle:** Protocol truth is observed; trading intelligence is inferred; execution is deterministic.  


# LPForge Position Management and Exit Intelligence

## 1. Mission

After entry, continuously compare the expected forward value of the existing position with:
- doing nothing;
- claiming;
- reshaping;
- rebalancing;
- reducing;
- closing to the configured numeraire.

Past entry logic must not trap the system in a position whose forward value is negative.

## 2. Position State Machine

```text
PLANNED
PRECHECKING
SUBMITTING
OPEN_PENDING
OPEN
IN_RANGE
NEAR_LOWER_BOUND
NEAR_UPPER_BOUND
OUT_OF_RANGE_BELOW
OUT_OF_RANGE_ABOVE
MANAGEMENT_PENDING
REBALANCE_PENDING
CLOSE_PENDING
CLOSED
FAILED
RECONCILIATION_REQUIRED
EMERGENCY
```

State is derived from on-chain facts plus workflow state; it is not manually toggled.

## 3. Allowed Decisions

- `HOLD`
- `CLAIM_FEES`
- `CLAIM_REWARDS`
- `RESHAPE`
- `REBALANCE`
- `REDUCE`
- `CLOSE_TO_NUMERAIRE`
- `EMERGENCY_CLOSE`
- `NO_ACTION_DATA_BLOCKED`

## 4. Forward-EV Rule

For each management cycle calculate:

```text
EV_hold
EV_reshape - reshape_cost
EV_rebalance - rebalance_cost
EV_reduce
EV_close
```

Action selection uses **incremental forward value**, not attachment to the original entry.

## 5. HOLD

Hold when:
- thesis remains valid;
- current forward EV is positive;
- alternative actions do not improve EV enough to recover their costs;
- risk remains within budget;
- data quality is adequate.

## 6. RESHAPE

Change concentration/range while preserving broad thesis when:
- regime remains compatible;
- expected local fee density moved;
- range can be improved without materially changing inventory thesis;
- incremental benefit exceeds cost and uncertainty.

## 7. REBALANCE

Use when:
- active price/range relationship changed materially;
- position orientation is no longer suitable;
- desired inventory composition differs;
- a new range has superior post-cost EV;
- thesis is still tradable but requires a new expression.

Current Meteora rebalance support should be used as a target-state operation where safe.

## 8. REDUCE

Reduce exposure when:
- uncertainty rises;
- risk budget shrinks;
- economics remain positive but tail risk becomes excessive;
- correlated exposure grows elsewhere;
- partial capital recovery dominates full hold.

## 9. CLOSE

Close when:
- thesis hard-invalidates;
- forward EV becomes non-positive;
- recovery probability is insufficient;
- toxic flow dominates expected fees;
- token/pool risk escalates;
- capital has a superior risk-adjusted alternative;
- configured maximum loss/time/risk constraints require closure.

## 10. OOR Intelligence

Out-of-range is not a single action trigger.

Measure:
- side of exit;
- distance in bins;
- exit velocity;
- regime at exit;
- return probability;
- expected time to return;
- inventory composition;
- fee velocity before exit;
- cost of re-entering.

Possible outputs:
- wait for return;
- reshape toward price;
- rebalance;
- close.

## 11. Near-Boundary Intelligence

Prevent predictable OOR losses by estimating:
- boundary first-passage probability;
- active-bin velocity;
- range remaining in bins;
- volatility;
- transition state.

Do not automatically rebalance every boundary touch; excessive churn can destroy fee economics.

## 12. Fee Claim Policy

Claiming should consider:
- claimable amount;
- transaction cost;
- need for capital/reinvestment;
- custody/risk policy;
- Token-2022 handling;
- planned rebalance that can combine claim.

Do not claim purely because a timer elapsed.

## 13. Thesis Monitoring

Each cycle records:
- unchanged evidence;
- improved evidence;
- deteriorated evidence;
- invalidated evidence.

The original thesis is immutable; produce `thesis_revision` if expectations change without full invalidation.

## 14. Accounting

Position value includes:
- token X/Y held in position;
- unclaimed fees;
- claimed fees attributable to episode;
- rewards;
- wallet residues caused by execution;
- realized transaction/composition/rebalance costs.

## 15. Acceptance Criteria

A post-mortem must show:
- why the system held as long as it did;
- when thesis deterioration began;
- whether earlier exit was a superior counterfactual;
- whether rebalancing recovered its cost;
- how much loss came from inventory conversion vs execution vs missed fee capture.
