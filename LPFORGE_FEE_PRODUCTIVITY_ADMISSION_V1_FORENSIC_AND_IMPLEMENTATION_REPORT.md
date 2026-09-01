# LPForge fee-productivity admission v1 — forensic result

Status: `HOLD_INSUFFICIENT_FEE_THRESHOLD_EVIDENCE`  
Investigation time: 2026-08-31 UTC  
Source examined: `c162ab4822fece374169cd8d78beed9052c0f545`  
Database access: read-only production PostgreSQL queries

## Executive finding

Production has **no hard, pre-candidate fee-productivity admission rule**.  A
pool with weak current fee production can reach the per-pool range/candidate
universe and can subsequently produce `ENTRY_READY`; Candidate-Primary does
not receive a terminal low-fee rejection.

That architectural gap is real.  It is **not yet defensible to fix it by
choosing a numeric `MIN_1H_FEE_TVL`**.  The largest usable prospective cohort
does not show a robust monotone relationship between decision-time 1h fee/TVL
and forward fee or net outcome.  Installing a floor now would be an arbitrary
policy retune, which this task explicitly forbids.

There is also a separate, material implementation risk: the canonical
discovery-metric contract defines `fee_tvl_ratio` as **percentage points**,
but the aggregate-rate fallback in `deriveAggregateRateEvidence` uses the
value directly as a fractional per-capital-hour rate.  This is a 100x unit
interpretation mismatch when that fallback is used.  The investigated live
entry used fresh `EVENT_PATH_ESTIMATE` evidence rather than that fallback, so
this finding does not establish that the fallback caused the entry; it must be
handled as a separately scoped fee-unit/forecast audit before any admission
policy is deployed.

No source, database, configuration, policy, migration, service, or live
position was changed.

## A. Current fee decision path

```text
Meteora standard/discovery API snapshots
  -> CanonicalDiscoveryMetrics (ratioUnit = PERCENTAGE_POINTS)
  -> cheap discovery score / pool priority (continuous fee score)
  -> pool deep screen (continuous fee density + fee persistence)
  -> active-candidate event-path economic estimate, when fresh
     (otherwise aggregate rate fallback)
  -> range construction and replay simulation
  -> fee-evidence-calibration-v1 (normalization-scale credibility)
  -> Candidate-Primary ranking within that pool's candidate universe
  -> P3 ENTRY_READY / NO_TRADE
  -> P4 / P7 / execution
```

### Exact sources and semantics

| Surface | Source | Current behaviour |
|---|---|---|
| Canonical ratio unit | `packages/discovery-metrics/src/index.ts` | Explicitly: `0.5` means `0.5%`, never `0.005`. |
| Discovery selection | `packages/pool-discovery/src/index.ts` | Fee/TVL is a continuous priority feature; its hard blocks are safety, TVL and volume conditions, not a 1h fee/TVL floor. |
| Deep screen | `packages/pool-deep-screen/src/index.ts::deepScreenPool` | `minFeePersistence = .35` is a soft `WATCHLIST` reason.  A low fee score/persistence is not itself `BLOCK`. |
| Operational economics | `packages/operational-runtime/src/index.ts::evaluateOperationalCycle` | Fresh event-path evidence (age <= 300 seconds) is preferred; otherwise aggregate fee rate is used. |
| Aggregate fallback | `packages/operational-runtime/src/index.ts::deriveAggregateRateEvidence` | Uses `pool.fee_tvl_ratio['1h']` directly as `feeRatePerCapitalHour`; inconsistent with the percentage-point contract. |
| Event-path estimate | `packages/active-candidate-evidence/src/index.ts::deriveEventPathEconomicEstimate` | Uses non-overlapping 5m fee buckets and event/bin evidence; validates maturity/counts, but has no absolute productivity floor. |
| Calibration | `packages/fee-evidence-calibration/src/index.ts` | `fee-evidence-calibration-v1` scales replay fees by normalization-scale credibility.  It is not a demonstrated-fee baseline gate. |
| Ranking | `packages/candidate-ranking/src/index.ts::rankCandidates` | Ranks strategies/ranges within one pool.  It has no admission-result input and no hard fee floor. |

Candidate-Primary therefore does not compare all pools globally; it chooses a
range/strategy **after the pool reached evaluation**.  Still, a weak pool can
enter that path because no preceding terminal productivity admission exists.

## B. Live evidence

All values below are frozen at decision time, except explicit live accounting
fields.  Fee/TVL values are percentage points (`0.01 = 0.01%`).

| Case | Pool | Decision-time 1h / 24h fee/TVL | Candidate fee forecast / candidate net EV | Observed outcome limitation |
|---|---|---:|---:|---|
| Current BID_ASK / SKEWED_Y | `EsR3…Qfs7` | `0.0096425%` / `2.1212841%` | `0.00008955` / `0.00006255` SOL | Still open; no realized economics row. Latest reconciled OOR state reports 54,424 lamports fee value, but it is not terminal accounting. |
| Canary #4 (`GRyr…hqC2`) | `2VHM…Krd9` | `0.0316985%` / `0.6063117%` | `0.00034434` / `0.00024671` SOL | Legacy live-learning settlement has `direct_fee_sol_lamports=0` and a net result inconsistent with the 0.03 SOL basis.  It predates complete M0065 decomposition; cannot calibrate a floor. |
| `8G992…bjsQ` | `EsR3…Qfs7` | `0.1062017%` / `2.0572195%` | `0.00060027` / `0.00054351` SOL | Legacy settlement has zero direct-fee attribution and an implausible negative total. |
| `F3V7…9ue1k` | `EsR3…Qfs7` | `0.0881949%` / `2.0826550%` | `0.00022267` / `0.00008871` SOL | Same pre-M0065 accounting limitation. |
| `DrbJX…MK7w` | `EsR3…Qfs7` | `0.0182117%` / `2.4638708%` | `0.00017165` / `0.00009968` SOL | M0063 fee attribution captured 39,798 lamports, but it was an emergency-exit case, not a clean fee-admission label. |
| `BhhR…pEx` | `EsR3…Qfs7` | `0.0208831%` / `2.1501613%` | `0.00018097` / `0.00012380` SOL | Settlement is incomplete for fee/inventory attribution. |

The current live decision’s upstream API snapshot was 22.9 seconds old:
fees 1h `$1.1941`, TVL `$12,383.60`, which independently computes to
`0.0096425%`.  Its fresh event-path estimate was `0.00006720` fee rate per
capital-hour (age 268 seconds); the aggregate fallback was not used.

Current-position classification: `MIXED` — a true missing admission boundary
exists and the current short-window fee signal is weak relative to 24h, but
there is not yet terminal live accounting that proves the entry was a
low-productivity loss.  Canary #4 classification: `MIXED` — admission is
missing, forecast was optimistic, and the old settlement decomposition is not
sufficiently reliable to make it a calibrated-fee label.

## C. Forward cohort and threshold sensitivity

The largest compatible prospective cohort is selected P3 `ENTRY_READY`
decisions with both frozen `poolQualityShadow` fee metrics and a `FINAL`
capital-constrained V2 30-minute forward outcome:

* period: 2026-08-23 through 2026-08-31 UTC;
* 61 pools, 16,100 frozen decisions total;
* 5,773 `ENTRY_READY`; 4,458 have final 30m outcomes;
* **3,945** have both final 30m outcome and frozen fee shadow metrics;
* outcomes are selected-candidate forward replays, not settled live-position
  accounting and not a complete all-candidate reranking cohort.

| Floor (percentage points) | Pass n | Pass positive net rate | Rejected positive net rate | Pass mean net SOL | Rejected mean net SOL | Pass mean fees SOL | Rejected mean fees SOL |
|---:|---:|---:|---:|---:|---:|---:|---:|
| none | 3,945 | 68.75% | — | 0.0002320 | — | 0.0000881 | — |
| 0.005% | 3,406 | 69.96% | 61.04% | 0.0001782 | 0.0005717 | 0.0000870 | 0.0000950 |
| 0.010% | 3,170 | 70.88% | 60.00% | 0.0001811 | 0.0004401 | 0.0000871 | 0.0000921 |
| 0.020% | 2,782 | 72.14% | 60.62% | 0.0001843 | 0.0003460 | 0.0000864 | 0.0000922 |
| 0.050% | 1,617 | 71.49% | 66.84% | 0.0002014 | 0.0002532 | 0.0000896 | 0.0000870 |
| 0.100% | 925 | 76.54% | 66.36% | 0.0002340 | 0.0002314 | 0.0001051 | 0.0000829 |

The apparent improvement in pass-side positive rate is not enough: every
candidate floor shown removes a population with positive mean forward net
outcome, and the relationship is non-monotone.  In particular, the `<0.005%`
group (n=539) had mean forward fee `0.0000950 SOL` and mean net
`0.0005717 SOL`, higher than the no-floor cohort.  The 30m correlations were:

* fee1h/TVL vs forward fee: **−0.0016**;
* fee1h/TVL vs forward net: **+0.0136**;
* fee24h/TVL vs forward fee: **+0.1009**;
* fee24h/TVL vs forward net: **+0.0449**.

60m and 120m sensitivity checks showed the same warning: higher floors raised
positive-rate modestly, while rejected low-1h groups retained higher mean net
outcomes.  This cannot support a universal hard floor.

### 1h-only versus persistence

Using decision-time `fee1h / (fee24h / 24)` as a descriptive persistence
ratio did not rescue the hypothesis.  The most collapsed band (`<0.1`, n=780)
had 63.85% positive 30m outcomes and mean forward net `0.0004550 SOL`; the
`0.1–0.25` band (n=485) had 76.08% positive and mean net `0.0002346 SOL`.
Neither is a safe policy boundary.  The current pool’s ratio was about 0.109;
Canary #4’s was about 1.25.  A policy made solely to reject the current pool
would be post-hoc fitting.

## D. Same-universe analysis

The retained complete universe for the current entry contains 36 strategy/range
candidates, all for `EsR3…Qfs7`.  Candidate-Primary selected
`narrow-11-4-6-bid_ask-skewed_y-1000`; it did not choose between a low-fee
pool and a high-fee pool.  Its ranking utility was `0.00004239`; alternatives
were lower-utility variants of the same pool.  Thus this case cannot establish
`RANKING_DEFECT` across pools.  It demonstrates `ADMISSION_DEFECT` in the
architectural sense: no pool-level hard rejection occurs before construction.

The current data model also lacks an all-pool, same-timestamp, complete
candidate-outcome cohort: M0064 complete-universe coverage is still maturing
and prior detailed candidate labels are selection-limited/terminally mixed.
It cannot fairly supply missed-pool opportunity counts for a production hard
gate today.

## E. Required evidence before implementation

Do not create `fee-productivity-admission-v1` yet.  First collect a new,
look-ahead-safe prospective cohort with, per pool/decision:

1. canonical percentage-point fee/TVL plus explicit fractional conversion;
2. source and observation timestamps; 
3. 5m/15m/30m/1h fee and volume/TVL facts, not just a 24h aggregate;
4. actual forward candidate fees and inventory outcome for all comparable
   admitted/rejected pools; and
5. settled M0065 realized fee/inventory/transaction decomposition for live
   positions.

Then pre-register candidate floors and evaluate them by strategy and regime on
an untouched chronological hold-out.  A valid future policy must make the
admission result durable and terminal before range construction, retain
rejected candidates for research, and expose a separate post-construction
candidate fee-credibility comparison against the observed baseline.

## What was not done

* no `MIN_1H_FEE_TVL` value was selected;
* no candidate fee-credibility gate was added;
* Candidate-Primary, P3, P4, P7, fee calibration, OOR lifecycle, capital, and
  execution were unchanged;
* no migration, deployment, restart, transaction, or live-position action was
  performed.

