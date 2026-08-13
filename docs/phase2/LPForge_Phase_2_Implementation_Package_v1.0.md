# LPForge — Detailed Phase 2 Implementation Package v1.0

**Prepared:** 12 August 2026  
**Status:** IMPLEMENTED RESEARCH BASELINE / VPS VALIDATION REQUIRED  
**Primary scope:** LP Economics Laboratory + Pool Intelligence  
**Code companion:** `LPForge_Phase_2_Complete_Implementation_v1.0.zip`

## 1. Implementation mandate and phase boundary

Phase 2 converts the Phase 1 read-only Meteora observation foundation into a reproducible LP research laboratory. It must be capable of measuring actual-position behavior, replaying bounded hypothetical positions with explicit fidelity grades, separating fee income from inventory effects, measuring range survival/OOR behavior, and producing an explainable pool-quality assessment.

Phase 2 **does not** decide that capital should be deployed. It does not contain an entry engine, RangeForge winner selection, portfolio allocator, signer, swap, liquidity-add/remove, claim or rebalance execution path.

### Non-negotiable Phase 2 exit

The system can demonstrate, from deterministic fixtures and then target-host data, that:

1. protocol math/accounting primitives match documented integer formulas;
2. actual positions and hypothetical positions are never assigned the same evidence fidelity;
3. synthetic fee attribution carries its approximation warning;
4. range active-time/OOR/revisit metrics are reproducible;
5. historical fee persistence can distinguish recurring fees from a burst;
6. high headline fees cannot override a blacklist/freeze hard block;
7. one-way toxic flow is separately measured from fee economics;
8. chronological experiments reject future-data leakage;
9. no transaction-signing/state-changing path exists.

## 2. Source discipline

Phase 2 is grounded in official Meteora protocol facts:

- bin price/liquidity, integer fee calculation, MM protocol/LP fee split, liquidity-share creation, pro-rata withdrawal and composition fee: `https://docs.meteora.ag/core-products/dlmm/formulas`
- `Swap2Evt` and lifecycle/accounting events: `https://docs.meteora.ag/developer-guides/dlmm/program/events`
- current TypeScript SDK read methods and protocol helpers: `https://docs.meteora.ag/developer-guides/dlmm/typescript-sdk/reference`
- pool aggregate/risk fields and historical volume/fee buckets: `https://docs.meteora.ag/api-reference/dlmm/pools/pools` and `/volume/history` documentation.

Protocol facts are observed. Research heuristics are versioned. Estimates are labeled.

## 3. Phase 2 technical additions

### Packages

- `@lpforge/simulator` — actual position forensics, synthetic bin-share replay, event-path fee attribution, range outcomes.
- `@lpforge/pool-intelligence` — token/pool risk mapping, fee sustainability, toxicity and explainable research assessment.
- `@lpforge/research` — chronological split, lookahead guard, experiment comparison/hashing and counterfactual runner.
- extended `@lpforge/accounting` — Meteora integer protocol-math primitives.
- extended `@lpforge/data-api` — historical fee/volume buckets.
- extended `@lpforge/db` — research persistence.

### App

`apps/lab` provides:

```bash
node .build/apps/lab/src/main.js fixture-report
node .build/apps/lab/src/main.js live-pool <POOL_ADDRESS>
```

`live-pool` is read-only and intentionally returns a conservative one-shot assessment if collector history is not yet present.

## 4. Simulator fidelity model

| Fidelity | Meaning | Permitted claim |
|---|---|---|
| `ONCHAIN_POSITION` | Actual observed position timeline | Highest Phase 2 confidence for position forensics |
| `BIN_SHARE_REPLAY` | Synthetic position replay over observed bin frames | Inventory/range counterfactual with stated small-LP assumption |
| `EVENT_PATH_ESTIMATE` | Aggregate Swap2Evt MM fee distributed across traversed bins then by synthetic share | Approximate hypothetical fee capture only |
| `AGGREGATE_ESTIMATE` | API-level estimate | Screening/research context only; never exact PnL |

A lower-fidelity result must never be relabeled upward merely because the result looks plausible.

## 5. Synthetic replay assumption

Synthetic replay assumes the hypothetical LP is sufficiently small that it does not change the observed market path. This is required to perform counterfactual research on a historical chain path. It is not a claim that a large hypothetical deposit would have been market-neutral.

Phase 3 should improve candidate initialization by using current SDK quote/simulation primitives before any RangeForge candidate is treated as execution-realistic.

## 6. Pool Intelligence baseline

The engine keeps separate sub-scores:

- economic quality;
- flow quality;
- liquidity quality;
- token-risk quality;
- toxicity probability.

Hard blockers remain independent of scores. Examples: protocol incompatibility, bad/stale critical data, blacklist, enabled freeze authority under policy, excessive reference divergence, or a configured liquidity-collapse condition.

`ELIGIBLE` in Phase 2 means **eligible for further research**, not approved for trading.

The file `policies/research-pool-policy-v1.json` is explicitly labeled `RESEARCH_ONLY`.

## 7. Historical sustainability

The Data API historical volume endpoint is used to compute:

- active fee-bucket ratio;
- fee mean and standard deviation;
- coefficient of variation;
- normalized fee trend;
- protocol-fee share;
- persistence score.

This prevents a one-bucket volatility/fee spike from automatically being interpreted as sustainable economics.

## 8. Research integrity

The research package enforces:

- chronological train/research, validation and test splits;
- no random shuffling of temporal market records;
- an explicit lookahead guard;
- experiment hypotheses and primary metrics defined before comparison;
- stable hash of experiment output;
- labeled counterfactuals.

## 9. Database additions

`M0007_phase2_lab.sql`
- preserves bin fee-growth fields;
- preserves Swap2Evt `amount_left`, `fee_bps`, `fees_on_input`, `fees_on_token_x`;
- adds simulation runs, forensic episodes and counterfactual results.

`M0008_pool_intelligence.sql`
- adds pool assessments;
- experiment specifications/results.

All Phase 1 migrations remain unchanged and regression-tested.

## 10. Exact implementation sequence

See `PHASE_2_SEQUENCE.md`. P2-01 through P2-14 must remain independently reviewable even though this package contains the integrated implementation.

## 11. Phase 2 test matrix

Mandatory:

- protocol integer math/rounding;
- exact raw-token valuation regression;
- historical Data API route/schema;
- range path both directions;
- deterministic synthetic inventory;
- OOR side, first passage and revisit;
- event-path fee-share calculation and fidelity warning;
- actual-position fee/inventory delta;
- blacklist/freeze hard block;
- healthy two-way research eligibility;
- high-directionality toxicity;
- fee sustainability stable-vs-burst;
- economics attribution summary;
- chronological split;
- lookahead rejection;
- experiment reproducibility;
- Phase 1 and Phase 2 no-signing boundary scans;
- all eight migrations static validation.

## 12. Development/agent operating rule

Any future coding agent working on this repository must:

1. preserve existing passing tests;
2. identify the numbered Phase work item affected;
3. never promote an estimate's fidelity without new protocol evidence;
4. never turn `RESEARCH_ONLY` policy into live permission;
5. never add signer/private-key/transaction-sending code during Phase 2;
6. report changed files, tests, migrations and evidence.

## 13. Phase 2 exit states

- `PASS` — local + VPS dependency install + blank PostgreSQL migrations + live read-only Meteora smoke + research fixture and target-pool lab evidence all pass.
- `PASS-WITH-ENVIRONMENT-OPEN-ITEMS` — implementation/test suite passes but target-host dependency/database/live-read evidence remains outstanding.
- `HOLD` — any correctness, migration, no-signing, data-fidelity or reproducibility gate fails.

## 14. Explicitly deferred to Phase 3

- full Regime & Structure Intelligence;
- Opportunity/Entry state machine;
- RangeForge candidate generation/winner selection;
- capital allocation;
- wallet/signer;
- live transaction execution;
- automated position management.

Phase 3 must consume Phase 2 evidence; it must not bypass the laboratory by hardcoding strategy folklore.
