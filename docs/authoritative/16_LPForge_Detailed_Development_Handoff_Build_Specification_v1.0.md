> **Project:** LPForge  
> **Suite Version:** 1.0  
> **Design Baseline Date:** 12 August 2026  
> **Status:** Build-guiding baseline  
> **Scope:** Meteora DLMM liquidity intelligence, decisioning, simulation, execution and operations  
> **Principle:** Protocol truth is observed; trading intelligence is inferred; execution is deterministic.  


# LPForge Detailed Development Handoff / Build Specification

## 1. Instruction to Development Agent

Build LPForge as a new repository from these documents. Do not begin by implementing strategy entry rules. Establish protocol/data/accounting correctness first.

Do not silently invent thresholds. Where a numeric policy value is not defined, create a named configuration key with a conservative disabled/default state and document it.

## 2. Phase 0 — Repository and Governance

Create:
- monorepo structure from Document 03;
- lint/typecheck/test;
- environment schema;
- migrations;
- policy loader;
- traceability mapping;
- structured logger;
- CI.

Acceptance:
- one command runs checks;
- invalid config fails startup;
- policy immutable once loaded.

## 3. Phase 1 — Meteora Protocol Adapter

Implement:
- pool client;
- `LbPair` read;
- active bin;
- bins around active;
- PositionV2 read;
- fee info/dynamic fee;
- oracle/TWAP wrapper;
- event decoder;
- protocol compatibility record.

Acceptance:
- decode a curated set of mainnet pools read-only;
- compare active bin/position/bin values with SDK;
- decoder golden tests.

## 4. Phase 2 — PostgreSQL Canonical Data Spine

Implement migrations for Document 04 protocol/market tables.

Implement:
- idempotent event insert;
- cursor/watermark;
- pool snapshots;
- swap events;
- liquidity/rebalance events;
- external price record;
- data quality.

Acceptance:
- restart safe;
- duplicate events harmless;
- gap flagged.

## 5. Phase 3 — Meteora Data API Adapter

Implement central client with:
- 30-RPS-safe limiter;
- retry with jitter;
- pagination;
- typed schemas;
- pool discovery;
- aggregate metrics;
- OHLCV;
- historical volume.

Never call API directly outside adapter.

Acceptance:
- cached discovery;
- schema change fails loudly;
- API outage produces degraded state, not fabricated values.

## 6. Phase 4 — Feature Engine

Implement versioned feature schema from Document 05.

Start deterministic; no ML.

Feature groups:
- bin movement;
- local liquidity;
- swap flow;
- fee quality;
- volatility;
- reference divergence;
- range survival history;
- token risk.

Acceptance:
- same input -> same vector;
- no future leakage in replay;
- freshness/missingness explicit.

## 7. Phase 5 — Accounting and Simulator BEFORE Strategy

Build bin-aware simulator and portfolio accounting.

Required:
- candidate position per-bin weights;
- swap traversal/fee allocation;
- inventory conversion;
- claims;
- composition fees;
- transaction cost;
- rebalance;
- HODL benchmark;
- SOL/USD result.

Acceptance:
- golden scenarios hand-computable;
- no fee double counting;
- realistic OOR inactivity.

**Do not proceed to strategy engines until this is trusted.**

## 8. Phase 6 — Pool and Token Intelligence

Implement rule-based baseline from Document 06:
- protocol block;
- token risk;
- liquidity quality;
- fee persistence;
- flow toxicity;
- sustainability.

All outputs reason-coded.

Acceptance:
- high-fee toxic fixture blocked;
- healthy two-way fixture distinguishable;
- stale-data fixture blocked.

## 9. Phase 7 — Regime Intelligence

Implement deterministic baseline with probability-like normalized evidence scores first.

Required classes from Document 07.

Acceptance:
- curated golden episodes;
- classifier stability;
- transition/unknown behavior;
- no label flapping resetting evidence history.

Do not optimize historical return at this stage.

## 10. Phase 8 — Opportunity / Thesis Engine

Implement:
- state machine;
- economic forecast interface;
- entry readiness;
- thesis object;
- invalidation rules;
- expiry;
- decision evidence bundle.

Acceptance:
- every `NO_TRADE` reason-coded;
- every `ENTRY_READY` has thesis;
- stale entry plan expires.

## 11. Phase 9 — RangeForge

Implement candidate generator:
- Spot;
- Curve;
- BidAsk;
- widths/asymmetry;
- one-sided/balanced where protocol-valid;
- per-bin weights;
- execution-cost quote;
- stress tests;
- candidate utility.

Acceptance:
- returns alternatives, not only winner;
- reports why winner beats alternatives;
- respects position width and operational constraints.

## 12. Phase 10 — Risk Governor

Implement before signer:
- global/pool/token/position limits;
- data-health blocks;
- inventory;
- capital reservations;
- breakers;
- kill switches.

Acceptance:
- concurrency cannot overallocate;
- strategy cannot bypass;
- stale approval fails.

## 13. Phase 11 — Shadow Runtime

Connect current real-time data to:
- pool assessment;
- regime;
- opportunity;
- thesis;
- range candidates;
- risk;

but no transaction signing.

Store every decision for outcome tracking.

Run until data quality and forecast capture are demonstrably stable.

## 14. Phase 12 — Position/Execution Adapter in Non-Live Harness

Implement:
- plan preflight;
- SDK tx building;
- simulation;
- idempotency;
- send interface behind `LIVE_SIGNING=false`;
- reconciliation.

Create mocked signer/devnet path where feasible.

Acceptance:
- all failure drills.

## 15. Phase 13 — Paper Trading

Paper engine consumes actual live decisions at decision time and uses execution-aware simulation.

Do not retrospectively alter an entry.

Required reports:
- fee vs inventory loss;
- HODL relative;
- OOR;
- forecast calibration;
- action attribution.

## 16. Phase 14 — Position Intelligence

Add:
- HOLD;
- CLAIM;
- RESHAPE;
- REBALANCE;
- REDUCE;
- CLOSE.

Use forward-EV comparison.

Shadow/paper management first.

## 17. Phase 15 — Limited Live

Only after Document 15 gate.

Requirements:
- separate capped hot wallet;
- manual enable flag;
- tiny capital caps;
- signer isolation;
- kill switch tested;
- real-time reconciliation;
- no auto-scaling.

## 18. Phase 16 — Learning Program

Only after simulator/live accounting is credible:
- survival models;
- regime probabilities;
- economic forecasts;
- policy experiments.

Keep frozen baseline control.

## 19. Required CLI/Operator Commands

At minimum:
```text
lpforge health
lpforge protocol verify
lpforge pools discover
lpforge pool inspect <address>
lpforge replay <episode/window>
lpforge decision explain <id>
lpforge position inspect <id>
lpforge reconcile <position>
lpforge policy list
lpforge policy diff <a> <b>
lpforge risk status
lpforge pause entries
lpforge pause writes
```

## 20. Definition of Done for v1

LPForge v1 is complete when it can:

1. discover a pool;
2. reproduce its key Meteora protocol state;
3. build bin-native/flow-native features;
4. reject unsafe/poor pools;
5. classify regime with uncertainty;
6. create a machine-readable LP thesis;
7. generate and compare multiple range candidates;
8. estimate realistic fee/inventory/cost economics;
9. apply independent risk controls;
10. shadow and paper trade reproducibly;
11. execute a capped approved plan through the official SDK;
12. reconcile on-chain state;
13. manage an open position;
14. produce a forensic episode and counterfactuals;
15. promote policies only through evidence.

## 21. Development Prohibitions

Do not:
- hardwire one global range width;
- make fee/TVL the sole pool selector;
- let a regime label directly sign;
- assume single-sided means no inventory conversion risk;
- assume an open position is earning;
- estimate all fees from global TVL;
- auto-retry unknown transaction errors;
- update historical decisions after the fact;
- let research write production policy;
- add live capital before reconciliation and accounting are proven.
