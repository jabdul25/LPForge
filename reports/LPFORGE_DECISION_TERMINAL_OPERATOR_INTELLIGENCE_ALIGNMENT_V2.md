# LPForge Decision Terminal Operator Intelligence Alignment V2

## Scope

Presentation and bounded read-model changes only. The terminal remains a read-only shell observer; no P3, P4, P6, P7, execution, policy, range, capital, settlement, reconciliation, schema, worker, or background-job behavior changed.

## Operator panels

* **Open Positions** now presents entry range, current bin, fresh live-control PnL, position age, range state, derived display-only risk state, active protection state, and next operational action. It uses the existing owned-position, latest-observation, exit-state, and OOR lifecycle reads.
* **Decision Pipeline** and **Current Blocker** retain deterministic reason-code explanations and now show bounded persisted market/live observation counts and live-confirmation state where retained.
* **Candidate Pipeline** presents discovered, filtered, watching, armed, entry-ready, and no-trade counts from the current bounded global-candidate and active-watch facts.
* **Range Monitor** explicitly labels its history as bounded. `NO OBSERVED OOR` avoids treating simple retained-path absence of OOR as a proven survival statistic.
* **Position Health** now calls its heuristic tags **Observed Loss Paths**, rather than causal loss causes.
* **Event Stream**, **Today**, and **System Health** preserve existing filters and read-only facts.

## MFE / giveback authority correction

Closed positions previously used `execution.position_exit_state.peak_net_return_fraction`, a managed-economic NAV diagnostic, under `MAX PROFIT`. This release changes closed rows to the confirmed Meteora-compatible live-control high-water:

```
execution.position_exit_state.lp_mtm_peak_return_fraction
```

The terminal now labels this **LIVE-CONTROL PEAK**. It shows **LIVE PEAK UNAVAILABLE** when no confirmed control peak exists; it never falls back to managed NAV.

The former `GIVEBACK` label is replaced with **LIVE-CONTROL PEAK GIVEBACK**. Its display formula is:

```
max(0, live_control_peak_return - canonical_settlement_return)
```

It is shown only when both fields are available. It is a peak-to-settlement observation gap, not a claim of executable proceeds.

The fills table now labels the historical heuristic as **OBSERVED LOSS PATH** and its reason mapping as **RECORDED EXIT/PROTECTION REASON**.

## Validation

* Typecheck: pass.
* Build: pass.
* Existing terminal test suite: 22/22 pass.
* Source test proves the closed terminal query uses `lp_mtm_peak_return_fraction` and does not select `peak_net_return_fraction`.

## Data sources

* `execution.position_exit_state` — confirmed live-control marks, live-control peak, existing protection payload/reasons.
* `execution.position_observations` and `execution.position_oor_lifecycle_state` — current range/OOR state.
* `execution.position_lifecycles`, `execution.lifecycle_sol_settlements`, and `execution.position_realized_economics` — canonical closed result and entry basis.
* `execution.production_global_candidates`, `market.pool_discovery_registry`, and `market.active_candidate_history_maturity` — current candidate and evidence-maturity display facts.
* Existing P7, execution, alert-outbox, and RPC-health observations.

## No behavioral change

Trading behavior unchanged: yes.  
Database schema/data unchanged: yes.  
Execution unchanged: yes.
