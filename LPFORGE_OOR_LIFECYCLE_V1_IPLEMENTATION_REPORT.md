# LPForge OOR Lifecycle v1 implementation report

## Scope and release

- Starting source: `a8afbd83759e2e196fe263d25c70e92df600b749`
- OOR implementation: `b49e8ece4767db57ecedd9442dc076a7374b5fe8`
- Final runtime correction: `1c463a3b23b86913cb9ccd2120f9badaebf30e34`
- Migration head: `M0065_oor_lifecycle_and_realized_economics.sql`
- Policy: `oor-lifecycle-v1`
- Entry policy, Candidate-Primary, P3/P4/P6/P7 economics, fee calibration, capital (exact 0.03 SOL), and max-one-position policy were not changed.

## Root cause and previous path

The operator refreshed PositionV2 and persisted an out-of-range observation, then delegated to normal live-position management.  The prior OOR path had no durable OOR start time or action deadline.  When position-specific forward continuation evidence was unavailable it returned `HOLD` with `POSITION_OOR_FORWARD_EV_UNAVAILABLE`; an old optional reshape path was the only possible OOR intervention.  Thus an OOR position could remain open indefinitely.

```
old: PositionV2 refresh -> OUT_OF_RANGE observation -> normal management
     -> forward EV unavailable -> HOLD
```

The missing edge was a durable, chain-reconciled OOR-duration transition from observation to a bounded close/re-evaluate decision.

## New state machine and policy

```
IN_RANGE
  -> TRANSIENT_OOR       [0–10m: monitor]
  -> SUSTAINED_OOR       [10–30m: fresh evaluation]
  -> OOR_ACTION_REQUIRED [30–60m: explicit hold/close decision]
  -> OOR_STALE_CAPITAL   [>=60m: CLOSE_AND_REEVALUATE]
```

Re-entry to range resets only continuous OOR duration; excursion count and total observed OOR duration remain durable.  Before an economic action the operator obtains current chain position/pool truth, verifies owner/position existence, checks the current bin/range relation, checks no close plan is active, and requires clean reconciliation.  A DB-only OOR indication cannot create a close.

Direction and inventory are persisted separately. `ABOVE_MAX` with actual WSOL/SOL inventory is `SAFE_OOR_SOL`; `BELOW_MIN` with non-native inventory is `OOR_TOKEN_EXPOSURE` and can use existing faster risk exits.  The policy never auto-recentres a range and never reuses an old recommendation.  After settlement, a replacement can only arise through normal fresh Candidate-Primary -> P3 -> P4 -> P7 -> execution authority, with the old lifecycle closed first.

## Persistence and accounting

M0065 adds `execution.position_oor_lifecycle_state` with first/latest observation, continuous start, re-entry, direction, excursion count, cumulative duration, inventory classification, fee-rate facts, recommendation, and reason codes.  It also adds `execution.position_realized_economics`, a compact permanent summary written from M0063 close attribution plus the durable SOL settlement.  M0063 raw-token fees remain the primary evidence; M0065 does not manufacture historical economics.

Terminal accounting keeps gross LP fee, rewards, principal, inventory/unwind result, transaction and swap costs, rent, final realized PnL, and reconciliation difference distinct.  OOR is a lifecycle reason, not an economic loss label.

All OOR state changes are idempotent upserts from persisted observations. Restart reconstructs the continuous timer. Existing execution plan claiming, transaction dispositions, and close idempotency prevent duplicate close/remove/claim/reopen activity.

## Tests and historical dry-run

Focused tests: 15/15 pass, including bounded OOR progression, re-entry timer reset, lower token-exposure action, stale/unreconciled chain truth hold, and lifecycle recovery wiring. Full canonical CI: 900/900 pass, all phase boundaries and migrations through M0065 passed. Release integrity passed with source commit `1c463a3…`, build identity `b5c01166…`, and the M0065 migration head.

The read-only replay found one position with compatible owned-position observations:

| Classification | Runs |
|---|---:|
| TRANSIENT (<10m) | 0 |
| SUSTAINED (10–30m) | 1 |
| ACTION_REQUIRED (30–60m) | 0 |
| STALE_CAPITAL (>=60m) | 1 |

The stale run is the live position below. Earlier managed lifecycles lack compatible range/active-bin observation coverage, so no profitability or additional-close counterfactual is claimed.

## Current live position handling

- Position: `BhhRQ4mwtvPcXzzGEskSqwY6D9NPhjNgpsganNsigpEx`
- Pool: `EsR3gRxMtqt3bBhDDsuY3SFyYNYvYzszzG9KVYpcQfs7`
- Entry: `2026-08-31T08:18:32.454Z`, exact 30,000,000 lamports
- Geometry: `CURVE / ONE_SIDED_Y`, bins `-589..-579`; entry active bin `-579`
- Fresh pre-close state: active bin `-573`, `ABOVE_MAX`, `SAFE_OOR_SOL`
- Continuous OOR: `2026-08-31T09:02:55.481Z` through decision at `2026-08-31T12:31:20.216Z` = 12,505 seconds (3h28m25s)
- Close policy result: `OOR_STALE_CAPITAL`, `CLOSE_AND_REEVALUATE`; fee rate since OOR was zero.

The autonomous operator—not an operator/manual transaction—created close plan `plan-271860abf6f54a54b3b15d7ed4b5bb02`. The remove, claim, and terminal close receipts confirmed; the optional unwind was proven zero-effect because both attributable non-native token quantities were zero. PositionV2 absence was confirmed, and the lifecycle reached `SOL_SETTLED` at `2026-08-31T12:39:35.153Z`.

Settlement evidence:

- Close-attributable LP fee: 175,671 lamports (raw X=0, raw Y=175,671)
- Earlier explicit LP fee claim: 174,982 lamports
- Principal returned: 29,824,144 lamports
- Inventory/unwind result: -175,856 lamports
- Recorded transaction costs: 30,000 lamports
- Rent locked/recovered: 57,406,080 / 57,406,080 lamports
- Final lifecycle SOL PnL: +144,797 lamports
- Accounting reconciliation difference: 0 lamports
- M0063 fee attribution: `COMPLETE`

No replacement position was created. Capacity was released only after terminal settlement, and future entry evaluation remains the normal fresh production pipeline.

## Deployment and remaining limitations

Only the execution runtime was restarted for the final settlement-observability correction. Production continued on the OOR policy release. Runtime verification reports production/execution online; P7 is `PRODUCTION / HEALTHY / NORMAL`, with `newEconomicActionAllowed=true`. Current portfolio capacity is clean: zero active positions, pending plans, reservations, UNKNOWN submissions, and reconciliation debt.

The existing operator-facing telemetry/log path contains the new OOR state/reason data. A separate dashboard rendering enhancement was intentionally non-blocking and is not part of this core lifecycle release.
