> **Project:** LPForge  
> **Suite Version:** 1.0  
> **Design Baseline Date:** 12 August 2026  
> **Status:** Build-guiding baseline  
> **Scope:** Meteora DLMM liquidity intelligence, decisioning, simulation, execution and operations  
> **Principle:** Protocol truth is observed; trading intelligence is inferred; execution is deterministic.  


# LPForge Risk Governor and Capital Protection

## 1. Role

Risk Governor is independent of alpha/intelligence. It may veto actions. Strategy engines may not override it.

## 2. Risk Layers

### Protocol risk
- incompatible program/IDL/SDK;
- disabled pool;
- unknown Token-2022 extension;
- stale on-chain state;
- abnormal program error rate.

### Token risk
- freeze/mint authority violation;
- blacklist/risk escalation;
- liquidity rug/withdrawal;
- supply anomaly;
- concentration threshold breach.

### Market risk
- freefall;
- extreme volatility;
- price/reference divergence;
- one-way toxic flow;
- liquidity gaps.

### Position risk
- token inventory percentage;
- OOR distance/duration;
- drawdown;
- thesis invalidation;
- unreconciled state.

### Portfolio risk
- total deployed;
- per-pool;
- per-token;
- correlated token exposure;
- daily loss;
- rolling drawdown;
- concurrent positions.

### Operational risk
- RPC health;
- signer health;
- stale features;
- DB lag;
- duplicate intent;
- failed reconciliation.

## 3. Hard Invariants

Examples of structural invariants:
- no live write without current risk approval;
- no new entry while global kill switch active;
- no new entry from stale critical data;
- no duplicate execution intent;
- maintain SOL fee reserve;
- no exposure above configured hard cap;
- no discretionary action while position reconciliation is unresolved;
- no unknown program compatibility state.

Numeric limits belong in policy, not this document.

## 4. Risk Decision

```json
{
  "decision": "APPROVE|BLOCK|EMERGENCY",
  "scope": "GLOBAL|WALLET|POOL|TOKEN|POSITION|ACTION",
  "reason_codes": [],
  "limits_consumed": {},
  "limits_remaining": {},
  "expires_at": "..."
}
```

## 5. Capital Reservation

Before entry:
1. reserve proposed capital;
2. reserve transaction/SOL buffer;
3. check competing plans;
4. commit reservation only when plan is accepted;
5. release on expiry/failure.

Prevents multiple workers from allocating the same balance.

## 6. Drawdown Controls

Track:
- realized;
- unrealized;
- HODL-relative;
- SOL-numeraire;
- daily;
- rolling;
- peak-to-trough.

Different breakers can react to different loss mechanisms.

## 7. Inventory Risk

For each volatile token:
- current wallet balance;
- position-contained balance;
- expected balance after adverse bin traversal;
- maximum possible conversion inside each position;
- aggregate worst-case inventory.

A nominal “SOL-sided” entry is not treated as permanently SOL-only after swaps begin.

## 8. Liquidity-Rug Response

Detect:
- large local liquidity removal;
- rapid TVL collapse;
- creator/large LP removal if observable;
- empty-bin gap formation;
- simultaneous price dislocation.

Escalate from block-new-entry to emergency management based on policy.

## 9. Emergency Mode

Emergency actions prioritize custody and reconciliation over optimal fee capture.

Possible effects:
- stop all entries;
- cancel pending plans;
- close/reduce approved positions;
- rotate RPC;
- disable signer after required exits;
- page operator.

Emergency logic must be deterministic and heavily tested.

## 10. Kill Switches

Provide:
- global software kill;
- signer disable;
- new-entry disable while management stays active;
- per-token/pool block;
- policy rollback.

Kill switches must be accessible without deploying code.

## 11. Risk Budget Attribution

Every position reserves:
- capital budget;
- downside budget;
- inventory budget.

A candidate's expected return is irrelevant if it cannot fit the remaining risk budget.

## 12. Acceptance Criteria

Risk tests must prove:
- strategy cannot bypass blocks;
- stale approvals expire;
- race conditions cannot over-allocate;
- reconciliation hold blocks new actions;
- kill switch prevents writes;
- emergency paths are executable using only on-chain facts when optional providers fail.
