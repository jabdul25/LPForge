# LPForge — Legacy vs Research V3 vs Current Production

## Read-only forensic comparison

Snapshot: 2026-08-31 (UTC), from the production PostgreSQL database and the
canonical source tree at `a8afbd83759e2e196fe263d25c70e92df600b749`.

No code, policy, configuration, production state, or database rows were
changed.  M0062/M0064 full-universe rows are explicitly excluded from the
primary Legacy/V3/Production comparison.  V3 below means the M0053–M0056
Reset3C decision-relevant lane, not the later full-universe lane.

## Executive conclusion

There is no defensible single economic winner yet.  The evidence supports a
conditional result:

| Question | Finding |
| --- | --- |
| Best research intelligence | Current Production has the clearest candidate-primary separation in its own canonical forward proxy, but this is not an independent realized-label result. |
| Opportunity capture | Not established. Legacy has the broadest discovery coverage; Production has higher quality among accepted candidates but rejects many counterfactual positives. |
| Loss avoidance | Production is strongest in the available h60 proxy (ENTRY_READY median `+0.000230` versus NO_TRADE median `-0.0000095`), with V3 directionally similar but weaker separation. |
| Prediction calibration | V3's embedded Legacy raw estimate has lower MAE than its canonical estimate at 30m/60m/120m on the sampled cohort. Production's positive-EV bins are directionally ordered but negative-EV bins still contain positive outcomes. No winner is proven. |
| Range quality | Production and V3 have explicit range/occupancy evidence. Legacy does not persist usable range-survival fields, so it cannot win this comparison. |
| Strategy selection | CURVE is the strongest observed family in both the V3 sampled candidates and Production's ENTRY_READY period; this is period- and cohort-specific, not a causal strategy proof. |
| Most conservative | Current Production, because P3/P4/P7 and candidate-primary gates reduce action frequency. |
| Most economically useful overall | `INSUFFICIENT EVIDENCE`; retain all three as separate evidence sources and collect an apples-to-apples prospective cohort. |

The most important finding is that the three systems do not emit the same
kind of label. Legacy emits a broad, approximate mark-to-market control
label; V3 emits a sampled, capital-constrained canonical counterfactual; and
Production emits a selected-candidate canonical counterfactual plus a very
small number of settled live records.  Treating these as one dataset would
create a false winner.

## 1. Architecture reconstruction

### Legacy Research

```text
apps/discovery
  -> packages/discovery-runtime (D1–D8 admission)
  -> packages/pool-deep-screen (quality, toxicity, fee persistence)
  -> packages/discovery-strategy-evaluation (SPOT_CENTER, CURVE_CENTER,
     SOL_BID_ASK)
  -> research.discovery_predictions
  -> apps/discovery-learning
  -> research.discovery_outcomes (counterfactual mark-to-market control)
```

The lineage is the D1–D8 import (commit `e9d7666`) and its follow-on
discovery-learning code.  The policy is `discovery-runtime-v2.1.1`; the
strategy model is `discovery-distributional-ev-v1`; capital research is
`.1 SOL`.  It is explicitly `DISCOVERY_ONLY_NO_EXECUTION` and has no P4/P7
authorization authority.  The strategy evaluator produces distributional
EV, pProfit, pLargeLoss, survival, and uncertainty, then selects a strategy
or `NO_TRADE`.

Its outcome collector uses historical 5-minute volume for the prediction's
time window, but obtains `current_price` and `current.tvl` when the worker
matures the row.  The persisted payload identifies the result as
`COUNTERFACTUAL_MARK_TO_MARKET_APPROXIMATION` and warns that it is not an
executed DLMM position.

### Research V3 (Reset3C)

```text
apps/operator / packages/shadow
  -> frozen P3 decision and full candidate facts
  -> M0053 variable-capital evaluation contract
  -> M0056 decision-relevant deterministic sample
  -> M0054 candidate_counterfactual_forward_outcomes
  -> matureFrozenPhase3ForwardOutcome (canonical V1/V2 replay)
```

V3 is the M0053–M0056 path.  M0053 stores append-only capital/position
contracts and constructibility status; M0054 stores immutable 30/60/120m
candidate outcomes; M0056 stores one compact census plus a deterministic
decision-relevant subset.  V3 compares embedded `legacyEconomics` with
`canonicalEconomics`, including ownership/price-taking constraints, but it
does **not** evaluate every candidate in a universe.  Its authority is
`RESEARCH_ONLY_NO_POLICY_MUTATION` and `COUNTERFACTUAL_CANONICAL`.

The candidate selector includes the current winner, current-rank winner,
legacy and canonical EV winners, disagreement winners, and a constructible
ownership-limit candidate.  This is a useful adjudication sample, not an
unbiased random sample.

### Current Production

```text
apps/operator::evaluateOperationalCycle
  -> packages/shadow::buildShadowRecommendation
     -> market context/structure/regime
     -> RangeForge candidates and simulations
     -> candidate-ranking (candidate-primary risk-adjusted utility)
     -> packages/opportunity (P3 progress)
  -> packages/entry-intelligence (P4)
  -> risk decisions / P7 (authorization)
  -> execution (only when separately authorized)
  -> phase3_forward_decisions / phase3_forward_outcomes (research proxy)
```

The current ranking policy is `candidate-primary-risk-adjusted-v1` with
candidate-local utility, inventory/OOR/cost/uncertainty penalties, and a
soft global context.  P4 uses `entry-research-v1`; P7 is a separate live
portfolio/risk authority.  Production forward outcomes use the frozen
canonical V2 replay, but most rows are counterfactual selected/top-ranked
labels, not executed positions.  M0062/M0064 retention and full-universe
research are not included as a Production decision gate here.

## 2. Dataset lineage and coverage

| Table / source | System represented | Snapshot coverage | Rows / units | Join key | Limitations |
| --- | --- | --- | --- | --- | --- |
| `research.discovery_predictions` | Legacy | 2026-08-17 13:19:25 to 2026-08-31 10:15:29 | 9,324 predictions; 83 pools | `prediction_id` | Strategy-level, not candidate/range-level; 2,703 SPOT_CENTER and 6,621 NO_TRADE. |
| `research.discovery_outcomes` | Legacy | rows matured 2026-08-24 to 2026-08-29 | 35,220 rows = 7,044 predictions × five horizons (30/60/120/240/360) | `prediction_id,horizon_minutes` | All observed classes are `NO_TRADE_COUNTERFACTUAL`; no executed-position label. |
| `research.variable_capital_evaluations` filtered to M0056 V3 (excluding `FULL_UNIVERSE_RERANK_COVERAGE`) | V3 | 2026-08-28 07:11:28 to 2026-08-31 ~10:21 | 10,633 candidate rows, 3,685 recommendation universes, 31 pools | `capital_evaluation_id`, `recommendation_id` | Decision-relevant sample only; roughly 2.9 candidates/universe, never 10+ candidates/universe. |
| `research.candidate_counterfactual_forward_outcomes` joined to M0056 V3 | V3 | 30/60/120m | At the repeatable-read snapshot: 30m 9,602 FINAL/787 INSUFFICIENT/53 PENDING; 60m 9,431/907/104; 120m 9,151/1,118/173. 191 sampled candidates had no outcome row at that snapshot for each horizon. | `capital_evaluation_id,horizon_minutes,outcome_model_version` | Canonical counterfactual, sampled and still partially incomplete. |
| `research.shadow_recommendations` | Production P3 candidate decision | 2026-08-16 11:16:21 to 2026-08-31 10:24:15 | 21,657 recommendations; 6,318 `ENTRY_READY`, 15,153 `REJECTED`, 112 `WATCHING`, 74 `QUALIFIED` | `recommendation_id` | Includes the full P3 stream; not all rows reach P4 or execution. |
| `research.entry_evaluations` / `research.risk_decisions` | Production P4/P7 | 2026-08-16 13:53:45 to 2026-08-31 10:21:04 | 6,316 P4 rows: 1,786 ENTRY_READY, 4,080 WAIT, 450 REJECT; 6,316 P7 rows, all APPROVE in this snapshot | `thesis_id` / risk ID | Authorization is not execution and should not be treated as realized performance. |
| `research.phase3_forward_decisions` filtered to non-M0062/M0064 production lineage | Production forward proxy | 2026-08-23 14:51:38 to 2026-08-29 23:26:14 | 14,563 decisions, 57 pools; 5,326 ENTRY_READY, 9,215 NO_TRADE, 22 WATCHING | `recommendation_id` | One selected/top-ranked frozen candidate per decision. |
| `research.phase3_forward_outcomes` filtered to V2 and the same production lineage | Production forward proxy | 30/60/120m | 43,686 rows for 14,562 decisions; 32,901 FINAL and 10,785 INSUFFICIENT, no pending in this snapshot | `recommendation_id,horizon_minutes,outcome_model_version` | Counterfactual canonical result, not execution PnL. |
| `research.live_learning_outcomes` | Production realized context | 2026-08-29 | 4 `LIVE_SOL_SETTLED` positions: 1 positive, 3 non-positive | `outcome_id`, lifecycle/plan lineage | Fee decomposition is incomplete (`UNAVAILABLE_WITHOUT_COUNTERFACTUAL_HODL_ALLOCATION` / per-lot allocation); sample is too small for a system comparison. |

### Overlap and matching

Distinct pool counts are Legacy 83, V3 31, and Production 57.  Pool
intersections are Legacy/V3 27, Legacy/Production 53, V3/Production 28, and
all three 24.  A same-pool ±5-minute match produced 43 Legacy/V3 pairs (42
Legacy rows and 30 V3 recommendations) and 156 Legacy/Production pairs (138
Legacy rows and 101 Production recommendations).  V3/Production produced
11,588 pairs because V3 is an overlay on the Production recommendation
lineage, not an independent stream.

Legacy has strategy-level predictions while V3 and Production have candidate
IDs and ranges.  No reliable exact candidate/range identity exists across
the three systems.  Therefore there is no valid apples-to-apples pool +
candidate + timestamp performance estimate.  The matched counts are useful
for overlap context only.

## 3. Standardized 60-minute outcome panel

All numbers below use each system's native forward label and are **not** a
claim that the units are identical.  Legacy used `.1 SOL`; V3 and Production
used `.03 SOL` capital contracts.  Means are shown in the native stored
value unit; returns should not be compared without also considering the
different outcome model.

| Metric (60m) | Legacy | V3 sampled candidate rows | Production selected decision rows |
| --- | ---: | ---: | ---: |
| Evaluations with outcome | 7,044 | 9,431 FINAL candidate rows | 10,984 FINAL selected/top-ranked rows (4,083 ENTRY_READY + 6,899 NO_TRADE + 2 WATCHING) |
| Action / ENTRY_READY rate | 2,703 / 9,324 = 29.0% | 4,376 candidate rows marked ENTRY_READY; not a trade rate | 5,326 / 14,563 = 36.6% P3 ENTRY_READY |
| Action/ENTRY positive outcomes | 909 / 2,694 SPOT rows = 33.8% | 2,960 / 4,376 = 67.6% | 3,415 / 4,083 = 83.6% |
| Action/ENTRY mean | +0.002493 | +0.000277 | +0.000379 |
| Action/ENTRY median | -0.007015 | +0.0000579 | +0.000230 |
| NO_TRADE positive outcomes | 1,895 / 4,350 = 43.6% | 2,941 / 5,055 = 58.2% | 2,673 / 6,899 = 38.7% |
| NO_TRADE mean | +0.001852 | +0.000154 | +0.0000925 |
| NO_TRADE median | -0.002277 | +0.0000188 | -0.00000949 |

The Production separation is the strongest in this panel, but it is not an
independent realized test: the `ENTRY_READY` and `NO_TRADE` labels are
generated from the same decision-time ranking and the future replay uses the
same frozen candidate context.

### Legacy horizons

Across all 7,044 Legacy labels, mean/median/positive rate were:

| Horizon | Mean | Median | Positive |
| --- | ---: | ---: | ---: |
| 30m | +0.001886 | -0.003785 | 2,796 / 7,044 (39.7%) |
| 60m | +0.002097 | -0.003735 | 2,804 / 7,044 (39.8%) |
| 120m | +0.002473 | -0.003390 | 2,848 / 7,044 (40.4%) |
| 240m | +0.003100 | -0.003005 | 2,924 / 7,044 (41.5%) |
| 360m | +0.003660 | -0.002707 | 2,983 / 7,044 (42.4%) |

The positive mean with a negative median is driven by a heavy positive tail,
not reliable broad profitability.

## 4. False positives, false negatives, and rejected positives

These are proxy classifications.  A “false negative” means a rejected or
NO_TRADE counterfactual was positive; it is not an executed missed trade.

### Legacy (60m, selected SPOT versus NO_TRADE control)

- TP: 909; FP: 1,785; TN: 2,455; potential FN: 1,895.
- Precision among labeled SPOT rows: 33.7%.
- Potential opportunity capture among labeled SPOT/NO_TRADE rows:
  `909 / (909 + 1,895) = 32.4%`.
- Positive-EV rejection is proven: 3,810 labeled NO_TRADE predictions had at
  least one positive strategy EV.  Their 60m outcome was positive in 1,895
  cases, with mean +0.001852 and median -0.002277.

### V3 (60m, candidate-status cohort)

- ENTRY_READY candidate rows: 2,960 positive and 1,416 non-positive.
- NO_TRADE candidate rows: 2,941 positive and 2,114 non-positive.
- 3,378 NO_TRADE candidate rows had positive canonical expected net; 3,155
  had a mature 60m label and 2,069 of those were positive.
- This is a candidate-sample result, not a recommendation classifier: V3
  intentionally sampled alternates and disagreement candidates.

### Production (60m, selected/top-ranked forward proxy)

- ENTRY_READY: TP 3,415; FP 668; precision 83.6%.
- NO_TRADE: 2,673 positive counterfactuals (potential FN) and 4,226
  non-positive (TN).
- 265 NO_TRADE rows still had positive `expectedNetEv`; 75 were positive and
  190 negative at 60m.  This is the largest observable opportunity-loss
  surface, but the labels are counterfactual and gate reasons overlap.

## 5. Gate-value analysis

Production h60 reason-code groups below are overlapping observational
groups, not randomized pass/fail experiments:

| Production reason group | n | Mean | Median | Positive |
| --- | ---: | ---: | ---: | ---: |
| `POSITIVE_RISK_ADJUSTED_CANDIDATE` | 6,123 | +0.000362 | +0.000230 | 83.1% |
| `CANDIDATE_PRIMARY_NO_LOCALLY_ACTIONABLE_WINNER` | 6,937 | +0.0000776 | -0.00000969 | 34.2% |
| `NO_TRADE_DOMINATES_CANDIDATES` | 5,233 | +0.0000597 | -0.00000978 | 30.0% |
| `EXPECTED_ACTIVE_TIME_LOW_SOFT` | 1,987 | +0.000284 | +0.000188 | 75.2% |
| `FLOW_TOXICITY_HIGH` | 450 | +0.000136 | -0.0000187 | 47.6% |
| `CANDIDATE_REPLAY_COVERAGE_INSUFFICIENT` | 296 | +0.001294 | +0.000105 | 69.9% |
| `FEE_CALIBRATION_NORMALIZATION_SCALE_CREDIBILITY` | 52 | +0.000264 | -0.0000100 | 40.4% |

The positive-risk-adjusted group is materially better than the no-locally-
actionable group, supporting the direction of Candidate-Primary.  The
coverage-insufficient group is a data-quality artifact and should not be
interpreted as a profitable gate.  The largest potentially damaging gate is
the candidate-primary/no-locally-actionable/no-trade surface, but the data
does not prove that it should be relaxed: many positive labels are small
counterfactual gains and the groups are selected, overlapping, and partly
self-referential.

V3's explicit capital gate has a similar but weaker separation at 60m:
`FEASIBLE_PRICE_TAKING` n=6,983, mean +0.000241, median +0.0000509,
positive 66.4%; `OWNERSHIP_LIMIT` n=2,441, mean +0.000127, median +0.00000430,
positive 51.7%.  This supports retaining ownership/constructibility as a
research diagnostic, not treating it as proof that every rejected candidate
was bad.

Legacy's deep-screen gates cannot be evaluated as clean pass/fail effects:
the stored outcome is a coarse control approximation and does not retain a
candidate/range-level matched outcome for each gate.

## 6. Prediction and calibration analysis

### Legacy

On labeled 60m SPOT_CENTER rows, the selected strategy's stored expected net
had MAE `0.025009`, forecast mean `+0.001550`, and realized mean `+0.002493`.
The magnitude is not comparable to V3/Production because Legacy uses a `.1
SOL` approximation and current-price/current-TVL labels.  Across all three
strategy rows per prediction, MAE was `0.020718`; the same outcome was copied
to each strategy, so that number is not a strategy-calibration test.

### V3

For M0056 sampled candidate rows with FINAL outcomes, the embedded Legacy raw
estimate versus V3 canonical estimate produced:

| Horizon | n | Legacy raw MAE | V3 canonical MAE | Actual mean |
| --- | ---: | ---: | ---: | ---: |
| 30m | 9,590 (adjacent live snapshot) | 0.000227 | 0.000558 | +0.000107 |
| 60m | 9,414 (adjacent live snapshot) | 0.000297 | 0.000575 | +0.000211 |
| 120m | 9,132 | 0.000427 | 0.000610 | +0.000362 |

The repeatable-read status snapshot had slightly different counts because the
research worker was appending rows during inspection.  The direction is
stable: V3's canonical forecast did not improve MAE over its embedded Legacy
raw forecast at 30m or 60m and was only marginally closer at 120m in the
selected subset.  This is evidence against declaring V3 an economic
improvement over Legacy, not evidence that V3's constructibility work has no
value.

### Production

At h60, predicted `expectedNetEv` bins were directionally ordered but not
well calibrated near zero:

| Predicted bin | n | Predicted mean | Actual mean | Actual median | Positive |
| --- | ---: | ---: | ---: | ---: | ---: |
| < -100 µSOL | 1,326 | -0.000111 | +0.0000908 | -0.00000982 | 40.4% |
| -100 to -50 µSOL | 5,495 | -0.0000715 | +0.000207 | -0.00000947 | 39.4% |
| -50 to 0 µSOL | 2,451 | -0.0000353 | +0.000120 | -0.00000965 | 36.3% |
| 0 to 50 µSOL | 942 | +0.0000224 | +0.000282 | +0.0000925 | 65.7% |
| 50 to 100 µSOL | 917 | +0.0000751 | +0.000338 | +0.000222 | 80.8% |
| >100 µSOL | 4,142 | +0.000415 | +0.000389 | +0.000245 | 84.7% |

Thus larger positive EV generally corresponds to better forward outcomes, but
negative predictions are not reliable negative labels.  Quantitative
uncertainty calibration is not independent: Production uncertainty is part of
the same decision/evidence path (median approximately 0.798, p95 0.895), so a
causal uncertainty result is N/A.  Legacy strategy uncertainty is lower
(median approximately 0.542, p95 0.654); this reflects different models, not
proven calibration superiority.

## 7. Regime, strategy, and range quality

### Regimes

Legacy predictions do not persist a comparable primary regime field.  V3
can recover regime from its shared shadow recommendation, but its compact
candidate contract is not a standalone regime census.  Production's current
shadow stream is dominated by TRANSITION (6,769), CONSOLIDATION (6,392), and
SIDEWAYS (3,775), with UNKNOWN 732, FREEFALL 660, RECOVERY 572, BREAKOUT 563,
TREND_UP 685, TREND_DOWN 449, and smaller classes.  These distributions are
not aligned in time or sampling and are shown only as context.

### Strategy outcomes at 60m

| System / strategy | n | Mean | Median | Positive |
| --- | ---: | ---: | ---: | ---: |
| V3 BID_ASK candidate rows | 4,179 | +0.0000898 | -0.000000494 | 49.1% |
| V3 CURVE candidate rows | 4,250 | +0.000351 | +0.000171 | 73.9% |
| V3 SPOT candidate rows | 995 | +0.000125 | +0.0000590 | 71.1% |
| Production ENTRY_READY BID_ASK | 1,075 | +0.000302 | +0.000110 | 89.4% |
| Production ENTRY_READY CURVE | 4,392 | +0.000395 | +0.000262 | 82.4% |
| Production ENTRY_READY SPOT | 266 | +0.000267 | +0.000166 | 78.6% |

Legacy selected only SPOT_CENTER (2,703 predictions), although it evaluated
CURVE_CENTER and SOL_BID_ASK.  Because Legacy copied one pool-level outcome to
each strategy row, its strategy ranking cannot be validated from outcomes.
CURVE is the strongest observed family in the later V3/Production samples,
but that is not a cross-period causal result.

### Range outcomes

- Legacy `range_survived` is NULL for the usable outcome rows; range quality
  is N/A, not zero.
- V3 h60 candidate rows: ENTRY_READY OOR 941/4,374 (21.5%), NO_TRADE OOR
  883/5,050 (17.5%); active ratios approximately 0.893 and 0.926.
- Production h60 selected rows: ENTRY_READY OOR 1,903/5,733 (33.2%), NO_TRADE
  OOR 2,735/9,537 (28.7%). At 120m, OOR was 2,740/5,460 (50.2%) for
  ENTRY_READY and 3,685/8,842 (41.7%) for NO_TRADE.
- Production ENTRY_READY range width has median 11 bins, p95 69, max 99;
  NO_TRADE has median 19, p95 99, max 99.  V3 candidate width has median
  approximately 15, p95 approximately 75, max 99 in the sampled contract.

The selected Production range did not have lower OOR at long horizons than
the rejected counterfactual, so range survival is not automatically evidence
that the entry gate selected a safer geometry.

## 8. Legacy ↔ V3 ↔ Production direct comparison

### Did V3 outperform Legacy?

**MIXED / INSUFFICIENT EVIDENCE.**  V3 adds frozen candidate contracts,
capital feasibility, ownership limits, and canonical replay.  Its ownership
gate separates weaker outcomes from feasible price-taking rows.  However,
V3's canonical forecast has worse aggregate MAE than its embedded Legacy raw
forecast at 30m/60m and only a small 120m improvement in one selected subset.
The systems have only 43 same-pool ±5m pairs and no exact candidate identity,
so a direct economic win is not proven.

### Did Production improve V3?

Production preserves V3-era candidate simulation, capital-constrained V2
forward evaluation, and frozen look-ahead protections, then adds
Candidate-Primary ranking, P4 timing, and P7 portfolio authorization.  In its
own h60 proxy, Production ENTRY_READY has mean +0.000379 and median +0.000230
versus V3's sampled ENTRY_READY candidate mean +0.000277 and median +0.0000579.
This is suggestive of better selectivity, but the cohorts and units are not
identical and V3 is a sampled overlay on Production.  It cannot establish a
causal improvement.

### Did Production improve Legacy?

Production has much higher h60 selected precision (83.6% versus Legacy's
33.8% SPOT rows) and a much less negative selected median.  It also rejects
many counterfactual positives (2,673 positive NO_TRADE labels at h60), so it
may be conservative.  Legacy's heavy positive tail and broader discovery
stream do not establish superior opportunity capture because its labels are
not executed DLMM outcomes and its selected median is negative.

## 9. Counterfactual disagreement cases

These examples are deliberately not treated as matched economic proof:

| Case | Decisions | Recorded outcome / limitation |
| --- | --- | --- |
| Pool `2TD1f…`, within ±5m | Legacy `NO_TRADE` at 10:42:07; V3 nearby `NO_TRADE` at 10:42:10 (BID_ASK/ONE_SIDED_Y) | Legacy h60 control +0.0000318; V3 selected label about -0.0000097. Candidate/range identities differ. |
| Pool `5A15…`, 2026-08-22 12:06 | Legacy `SPOT_CENTER`; Production `REJECTED/NO_TRADE` at the same pool/time | Legacy h60 outcome -0.0376; Production selected outcome was not joinable in the stored V2 cohort. This is consistent with a possible avoided loss, not proof. |
| Pool `3S86…`, 2026-08-17 15:56 | Legacy `SPOT_CENTER`; Production `REJECTED/NO_TRADE` | Legacy h60 -0.0138; Production outcome unavailable for a same-candidate comparison. |
| Production h60 aggregate | ENTRY_READY versus NO_TRADE | +0.000379 mean / +0.000230 median versus +0.0000925 / -0.00000949. Strongest available separation, but partly self-referential. |

The four settled live records give context only: one +18,854,060 lamports
and three losses (-87,118,247, -84,687,407, -77,079,731).  All direct fee
fields are zero and the decomposition explicitly says fee/inventory
allocation is unavailable, so they are not valid realized-fee scorecard
labels.

## 10. Data leakage and evidence quality

1. Legacy has the largest timing problem.  The label collector uses a future
   historical-volume window but reads live `current_price` and `current.tvl`
   at maturation.  A delayed worker can therefore label a 30/60m prediction
   with a later price and later TVL denominator.  This is not a strict
   horizon-end label.
2. V3 `matureFrozenPhase3ForwardOutcome` establishes a baseline at or before
   decision time and filters future frames/events to `(T,T+h]`; the replay
   contract hashes the frozen decision and evidence.  No look-ahead was found
   in this path, but the sampled contract has missing/outcome-incomplete
   rows.
3. Production shadow explicitly rejects post-decision frames/events and the
   V2 maturer uses the same strict future window.  No code-level leakage was
   found in the inspected path.
4. V3 and Production canonical labels remain research counterfactuals and are
   partly self-referential: decision-time candidate/evidence selection and
   future replay are stored under the same recommendation lineage.  They are
   useful for ranking adjudication, not independent live-profit labels.
5. Existing M0062/M0064 full-universe rows were not substituted for V3.
   They remain a separate, newer retention/coverage lane.

## 11. Test and integrity evidence

The repository has explicit tests for the relevant contracts, including:

- `tests/phase3-p316-evaluation.test.mjs`: false-positive and missed-
  opportunity accounting;
- `tests/pool-discovery-d3d8.test.mjs`: Legacy distributional EV and
  NO_TRADE behavior;
- `tests/phase3-p315-shadow-runtime.test.mjs`: immutable shadow output and
  rejection of future frames/events;
- `tests/phase3-p313-ranking.test.mjs` and
  `tests/candidate-primary-risk-adjusted-v1.test.mjs`: NO_TRADE competition,
  replay insufficiency, and Candidate-Primary policy semantics;
- `tests/reset3c-decision-relevant-validation.test.mjs`: deterministic V3
  candidate sampling, shared-evidence reconstruction, and immutable storage;
- `tests/phase3-forward-validation-v2.test.mjs`: capital-constrained V2
  replay and ownership behavior;
- `tests/forward-horizon-bounded-evidence-loading.test.mjs`: bounded future
  evidence access;
- `tests/discovery-learning-runtime-bounds.test.mjs`: bounded independent
  maturation queues.

These tests prove implementation contracts, not economic superiority.  No
full CI or runtime state was changed or rerun for this read-only report.

## 12. Economic scorecard (defensible version)

| Metric | Legacy | V3 | Production |
| --- | --- | --- | --- |
| Evaluations | 9,324 predictions | 3,685 V3 universes / 10,633 sampled candidates | 14,563 P3 decisions |
| Actionable / ENTRY_READY | 2,703 SPOT_CENTER (29.0%) | 4,376 candidate rows; not a trade rate | 5,326 ENTRY_READY (36.6%) |
| 60m TP | 909 | 2,960 candidate-status positives | 3,415 |
| 60m FP | 1,785 | 1,416 candidate-status non-positives | 668 |
| 60m potential FN | 1,895 NO_TRADE positives | 2,941 NO_TRADE candidate positives | 2,673 NO_TRADE positives |
| 60m precision | 33.8% | 67.6% candidate-status rate | 83.6% |
| 60m opportunity capture | 32.4% proxy | Not a valid classifier rate | 56.1% proxy |
| 60m selected/ENTRY mean | +0.002493 | +0.000277 candidate ENTRY rows | +0.000379 |
| 60m selected/ENTRY median | -0.007015 | +0.0000579 | +0.000230 |
| 60m NO_TRADE mean | +0.001852 | +0.000154 | +0.0000925 |
| 60m NO_TRADE median | -0.002277 | +0.0000188 | -0.00000949 |
| Range/OOR calibration | N/A (NULL) | OOR 21.5% ENTRY / 17.5% NO_TRADE | OOR 33.2% ENTRY / 28.7% NO_TRADE |
| Realized live outcomes | N/A | N/A | 4 settled, 1 positive/3 negative; fee decomposition incomplete |

`N/A` means the required field or independent outcome was not persisted; it
does not mean zero or failure.

## 13. Final ranking and recommendation

### Ranking by defensible specialization

- **Forward selectivity / loss avoidance proxy:** 1. Production, 2. V3, 3.
  Legacy.  This is conditional on canonical proxy labels, not realized PnL.
- **Breadth of discovery and explicit rejected/control coverage:** 1.
  Legacy, 2. Production, 3. V3.  Breadth is not the same as quality.
- **Capital/constructibility diagnostics:** 1. V3, 2. Production (which
  carries the V2 mechanics), 3. Legacy.
- **Range evidence:** 1. Production/V3 (tie on availability, not outcome),
  3. Legacy (not persisted).
- **Prediction calibration:** no winner; V3 canonical is not better than its
  embedded Legacy raw estimate on the sampled MAE test, while Production EV
  bins are only partially monotonic.
- **Overall:** no ranking is justified; classification is
  `INSUFFICIENT_EVIDENCE`.

### Production recommendation

`COLLECT MORE EVIDENCE` before policy changes.  Keep current Production
research/entry logic unchanged for now.  Preserve V3's capital-feasibility
and legacy-vs-canonical disagreement diagnostics as research instrumentation,
and preserve Legacy's broad discovery/control stream for exploratory
coverage.  Do not hybridize decision authority yet: first build a genuinely
prospective, common candidate/range/time cohort with independent endpoint
labels and complete candidate coverage.  The first useful next analysis is a
strict same-pool/time prospective comparison with the same `.03 SOL`
capital, the same frozen canonical replay, and separately audited rejected
positive-EV cases.

## 14. Current Production context (not used to declare a winner)

- Canonical source: `a8afbd83759e2e196fe263d25c70e92df600b749`.
- `lpforge-production`, `lpforge-execution`, `lpforge-discovery`, and
  `lpforge-discovery-learning` were online at inspection.
- The lifecycle table contained four `SOL_SETTLED`, one `CLOSED`, and one
  `OPEN` position; six owned-position rows include historical settled rows.
- This live state is documented separately and was not substituted for the
  historical Legacy/V3/Production forward comparison.
- No execution, configuration, policy, database, or service action was taken.

## Final determination

The evidence does **not** establish that Legacy, V3, or Production has
demonstrated the strongest overall ability to identify economically useful LP
opportunities.  Production currently has the best *conditional* forward
selectivity signal, Legacy has the broadest but least trustworthy outcome
coverage, and V3 supplies the best constructibility/adjudication machinery
without a proven calibration/economic improvement over Legacy.  The proper
decision is to retain the architectures as separate lanes and collect an
independent common cohort rather than relax gates or promote a historical
winner.
