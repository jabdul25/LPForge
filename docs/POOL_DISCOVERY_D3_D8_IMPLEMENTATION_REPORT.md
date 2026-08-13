# LPForge Pool Discovery / Screening / Learning D3–D8 Implementation Report
## Baseline
- Source baseline: `43ff109b3a8de13e0e920031f9b1028d737f1d66`
- Frozen specification: `LPForge Autonomous Meteora Pool Discovery, Screening & Learning Engine v2.1.1`
- D1/D2 were integrated first; this change completes D3–D8.
## D3 — Deep Screening
Implemented `packages/pool-deep-screen`.
Deep evidence includes:
- Meteora protocol compatibility;
- active-bin and local bin geometry;
- non-empty ratio, gap structure, skew and active-bin share;
- real Swap2Evt flow when available;
- active-bin movement derived from event history;
- historical fee persistence;
- fee density;
- executable liquidity score;
- two-way-flow quality;
- directional toxicity;
- explicit evidence availability;
- opportunity half-life;
- separate `poolQualityScore` and `currentOpportunityScore`.
D3 cannot authorize execution.
## D4 — Persistent Universe / Operator Integration
Implemented `packages/pool-universe` and extended the discovery daemon.
Tiering:
- A — active candidate
- B — watch
- C — qualified reserve
- CONTROL — deterministic random qualified control
- REJECTED / QUARANTINED
The Phase-7 production service can optionally include Tier-A discovered pools in its operator evaluation universe using `LPFORGE_DISCOVERY_OPERATOR_ENABLED=true`. Existing execution-policy pools remain included. Discovery itself does not write execution plans; the existing operator remains the downstream intelligence/plan source, and the execution worker retains its independent claim guard.
PM2 entries added:
- `lpforge-discovery`
- `lpforge-discovery-learning`
## D5 — Strategy Survival / Distributional EV
Implemented `packages/discovery-strategy-evaluation`.
Research strategies:
- SPOT_CENTER
- CURVE_CENTER
- SOL_BID_ASK
- NO_TRADE remains a real outcome
Per strategy the research model emits:
- mean and median expected net value;
- P(profit);
- P(large loss);
- p05/p10/p25/p50/p75/p90/p95;
- expected shortfall;
- survival at 30m/1h/2h/4h/6h;
- uncertainty and reason codes.
This model is research/ranking evidence only. It does not replace the production RangeForge/EV/risk/capital chain.
## D6 — Prediction / Outcome Ledger
Migration M0031 adds:
- `research.discovery_predictions`
- `research.discovery_outcomes`
- deep-screen and universe-assignment tables
Predictions are persisted before future outcomes are known and preserve:
- selection cohort;
- universe percentiles;
- strategy distribution;
- deep evidence;
- policy/model version;
- independent episode key.
`apps/discovery-learning` collects approximate counterfactual outcomes for rejected/control predictions at 30/60/120/240/360 minutes.
Important: counterfactual mark-to-market rows are explicitly labeled `COUNTERFACTUAL_MARK_TO_MARKET_APPROXIMATION`; they are not equivalent to executed DLMM PnL. Executed outcomes must come from the live lifecycle/accounting subsystem.
## D7 — Learning / Reputation / Calibration
Implemented `packages/discovery-learning`.
Includes:
- independent market/regime episode keys;
- Brier-style profit and survival calibration;
- net-value MAE and bias;
- all-outcome performance versus calibration-segment performance;
- structural breaks never erase economic losses from all-outcome reporting;
- pool reputation;
- strategy reputation;
- pool × strategy × regime reputation;
- baseline selection;
- purged/embargo helper for overlapping target horizons;
- confidence constrained by independent episodes rather than raw observation count.
Baseline selectors:
- RANDOM_ELIGIBLE
- HIGHEST_FEE_TVL
- HIGHEST_PERSISTENT_FEE_TVL
- SIMPLE_FEE_LIQUIDITY_TOXICITY
## D8 — Governed Adaptation
Implemented `packages/discovery-governance`.
Proposal states are governed and sequential. No automatic policy mutation exists. Research may produce proposals only after sufficient calibration evidence. Production policy still requires an explicit versioned promotion process.
Persistence:
- `research.discovery_reputation`
- `research.discovery_calibration_snapshots`
- `research.discovery_baseline_results`
- `research.discovery_policy_proposals`
The database enforces `automatic_promotion = FALSE`.
## Authority Boundary
`verify-discovery-boundary.mjs` scans:
- pool-discovery
- pool-deep-screen
- pool-universe
- discovery-strategy-evaluation
- discovery-learning
- discovery-governance
- discovery-runtime
- discovery apps
and rejects imports/calls into transaction planner, live worker, signer, autonomous dispatch, execution runtime, canary, or transaction-plan/intent APIs.
## Validation
- Full TypeScript typecheck: PASS on the supplied dependency tree.
- Emitted build: PASS.
- D1–D8 discovery tests: 18/18 PASS.
- Discovery authority boundary: PASS.
- Migrations: M0001–M0031 static PASS.
- P1–P7 boundary scanners: PASS.
A raw all-repo Node test invocation found 382 tests, with 359 pass / 23 fail. The failing tests are the same environment/dependency family caused by the bundled Meteora runtime missing `@coral-xyz/anchor` (and related transitive runtime dependencies) under this sandbox. The D1–D8 discovery suite itself is green. Codex must install the exact pinned dependencies in its Node 24.19 environment and rerun the canonical `pnpm test:ci`.
## Development Verdict
D1–D8 are implemented as a complete discovery/research subsystem candidate.
Remaining work belongs to Codex closure:
1. verify exact dependencies under Node 24.19;
2. run full `pnpm test:ci`;
3. verify fresh and upgrade PostgreSQL migrations through M0031;
4. review D4 production-universe integration;
5. run discovery + learning daemons in shadow/read-only mode;
6. prove no discovery/learning path can sign/send or auto-promote policy;
7. collect prospective D1–D8 evidence;
8. patch only demonstrated correctness/integration defects;
9. freeze final release.
