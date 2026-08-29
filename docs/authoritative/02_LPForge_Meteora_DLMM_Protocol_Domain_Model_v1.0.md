> **Project:** LPForge  
> **Suite Version:** 1.0  
> **Design Baseline Date:** 12 August 2026  
> **Status:** Build-guiding baseline  
> **Scope:** Meteora DLMM liquidity intelligence, decisioning, simulation, execution and operations  
> **Principle:** Protocol truth is observed; trading intelligence is inferred; execution is deterministic.  


# LPForge Meteora DLMM Protocol Domain Model

## 1. Purpose

This document translates Meteora DLMM protocol mechanics into LPForge domain rules. These are protocol facts and compatibility constraints, not strategy opinions.

## 2. Core Protocol Model

DLMM represents a market as an `LbPair` containing token mints, reserves, active bin, bin step, fee parameters, reward/oracle state, function mode and other configuration.

Price is discrete. Each bin is one fixed price point:

```text
P(i) = (1 + bin_step / 10,000)^i
```

A bin contains market-making token amounts, liquidity shares, cumulative fee growth and, where applicable, limit-order state.

Only one bin is active at a time. Price changes as swaps consume liquidity and move through the bin ladder.

## 3. Canonical Meteora Entities

### `LbPair`
LPForge must store at minimum:
- pool address;
- token X/Y mint;
- token programs;
- active bin ID;
- bin step;
- base/dynamic/max fee state;
- collect fee mode;
- function type;
- reserves;
- reward slots;
- oracle;
- status;
- creator/config metadata;
- last observed slot.

### `BinArray`
- exactly 70 `Bin` entries per array;
- index maps to a contiguous bin-ID range;
- bitmap and optional bitmap extension determine initialized arrays.

### `Bin`
- bin ID;
- price;
- `amount_x`, `amount_y`;
- liquidity supply;
- cumulative fee growth X/Y;
- limit-order state when applicable.

### `PositionV2`
- pool;
- owner;
- lower/upper bin;
- per-bin liquidity shares;
- fee checkpoints/pending fees;
- rewards;
- claimed totals;
- lock release point;
- operator/fee owner;
- permission bits;
- dynamic extension data.

LPForge must assume current positions are `PositionV2`. Position storage begins with a default 70-bin layout and can expand up to 1,400 bins.

## 4. Strategy Families

Meteora exposes three underlying LP distribution families:

- `Spot`: uniform across selected bins.
- `Curve`: more concentrated toward the middle.
- `BidAsk`: more concentrated toward the edges.

LPForge must model:
- strategy family;
- lower/upper bin;
- one-sided/balanced/imbalanced deposit;
- exact per-bin weights actually requested;
- exact per-bin amounts observed after confirmation.

UI presets such as concentrated/spread/wide are not canonical strategy identities. Store the actual bin plan.

## 5. Function Mode

Current DLMM pools distinguish:

- `LiquidityMining`
- `LimitOrder`

A reward-enabled liquidity-mining pool does not simultaneously expose limit-order placement. LPForge must read the actual pool state; it must not infer capabilities from pool name or UI labels.

Initial LPForge live scope may use market-making positions only, but the schema and compatibility layer must understand both function modes so it never tries an invalid operation.

## 6. Collect Fee Mode

Store and branch on:
- `InputOnly`
- `OnlyY`

Fee denomination matters for LP inventory economics. Never assume all pools pay fees in both assets.

## 7. Fees

Total DLMM fee is bounded by protocol rules and combines base plus optional variable fee.

LPForge must persist separately:
- base fee;
- current dynamic fee;
- max fee;
- protocol share;
- MM fee earned by liquidity;
- limit-order fee where applicable;
- host/referral component if observed.

Never estimate LP fee revenue from gross swap fee alone when the event exposes component splits.

## 8. Dynamic Fee State

Dynamic fee responds to bin movement and decays over time. Therefore “high current dynamic fee” is not enough to infer future fee yield.

Required features include:
- current dynamic fee;
- recent bin-cross velocity;
- fee half-life/decay context derived from pool parameters;
- proportion of fee generation attributable to temporary volatility spikes;
- persistence after the spike.

## 9. Position Activity

A position can earn swap fees only in bins that actually participate in swaps. If price is outside the position range, the position remains open but becomes inactive until price returns or it is rebalanced.

Liquidity-mining rewards similarly depend on eligible active/crossed liquidity.

Therefore LPForge distinguishes:
- account open;
- position in range;
- liquidity active;
- fee-earning;
- reward-eligible.

These are not synonyms.

## 10. Claim Behavior

Fees and rewards are claimable balances; they do not automatically compound into DLMM liquidity.

`CLAIM` therefore changes custody/accounting, not the economic origin of PnL. Performance calculations must include both claimed and unclaimed value.

## 11. Rebalancing

Current protocol/SDK supports rebalance flows that can combine:
- claim;
- remove;
- resize;
- shrink;
- add liquidity.

Range management should therefore be represented as a target-state transformation, not a sequence of unrelated bot actions.

## 12. Position Width and Resize Constraints

Protocol-aware planning must consider:
- maximum position width: 1,400 bins;
- default inline position layout: 70 bins;
- extension/reallocation requirements;
- resize-instruction limits;
- bin-array initialization;
- bitmap extension requirements;
- rent and compute costs.

RangeForge may propose a mathematically valid range that Execution rejects as operationally inefficient. These are separate decisions.

## 13. Swap/Event Constraints

The 2026 limit-order release changed swap behavior and event layouts. LPForge must:
- prefer `Swap2Evt` for rich swap accounting;
- version event decoders;
- test against the current IDL;
- monitor Meteora changelog;
- never hardcode an old maximum swap-bin assumption.

## 14. Price Synchronization Risk

Meteora pool price can temporarily diverge from wider market price. LPForge therefore maintains:

```text
pool_reference_divergence_bps
pool_reference_age_ms
pool_reference_source
```

A stale or materially divergent pool must be blocked or treated by an explicit policy. Never open a concentrated position solely because the pool's local active-bin price appears attractive.

## 15. Protocol Compatibility Record

At startup and periodically, persist:

```json
{
  "program_id": "...",
  "idl_hash": "...",
  "sdk_package": "@meteora-ag/dlmm",
  "sdk_version": "...",
  "program_release_observed": "...",
  "data_api_schema_version": "...",
  "decoder_version": "...",
  "checked_at": "..."
}
```

Any unexpected compatibility change can put the system into `PROTOCOL_COMPATIBILITY_HOLD`.
