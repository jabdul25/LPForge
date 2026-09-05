# LPForge — Positive-EV → ENTRY_READY Conversion Forensic V1

## Scope and cutoff

- Read-only forensic; no source, database, deployment, policy, or runtime change.
- Runtime/source: `5ea5c0d5a1b529b593d93bbec90a9a583528d56e`.
- Cohort: `2026-09-01T23:19:04.782Z` through `2026-09-02T06:07:55.331Z` (6h 48m 51s).
- Population: 157 post-fix mature Candidate-Primary evaluations across 15 dynamic pools.
- Entry authority remained disabled; no transaction was submitted.

## Result

Only one evaluation converted because the dominant loss occurs before economics are allowed to become authoritative: candidate-specific range-survival evidence has zero completed samples for the best positive candidate in 54 of 58 positive-net mature evaluations. In 56 of 58, the same candidate's replay simulation is non-actionable because its 60-minute occupancy window is not `COMPLETE`.

These are correlated outputs of one underlying evidence contract, not three independent vetoes:

1. a candidate range needs at least one completed empirical survival outcome;
2. an outcome needs at least three future active-bin samples; and
3. elapsed occupancy needs at least 60% coverage with no gap above 450 seconds.

The direct replay-continuity check itself passed for the best positive candidate in all 58 positive-net evaluations. Fee calibration is downstream of replay actionability and is not an independent conversion loss in this cohort.

## Evaluation-level funnel

| Stage | Evaluations | Conversion from prior relevant stage |
|---|---:|---:|
| Mature Candidate-Primary evaluations | 157 | — |
| At least one positive-net candidate | 58 | 36.94% of mature |
| At least one positive-utility candidate | 41 | 70.69% of positive-net |
| Best positive candidate: direct replay continuity present | 58 | 100.00% of positive-net |
| Best positive candidate: range-survival evidence present | 4 | 6.90% of positive-net |
| Best positive candidate: simulation evidence actionable and fee-calibrated | 2 | 3.45% of positive-net |
| Positive locally actionable candidate | 1 | 2.44% of positive-utility |
| P3 `ENTRY_READY` | 1 | 2.44% of positive-utility; 1.72% of positive-net |

Candidate-alternative accounting is deliberately separate: 4,590 alternatives were ranked; 963 had positive net EV and 697 positive utility. The successful BUTTHOLE evaluation contained 29 positive-net and 25 positive-utility alternatives. Alternatives are not independent opportunities and are not used as the headline conversion denominator.

## First failing gate — best candidate per positive-net evaluation

| First independent failure | Evaluations | Share of 58 |
|---|---:|---:|
| Candidate-specific range-survival evidence has zero completed samples | 54 | 93.10% |
| Replay/occupancy simulation actionability (without a survival-sample failure) | 3 | 5.17% |
| No failure; converted | 1 | 1.72% |

The apparent downstream code family `FEE_CALIBRATION_RAW_REPLAY_NOT_ACTIONABLE`, `NO_TRADE_EVIDENCE_NON_ACTIONABLE`, and `RANK_EVIDENCE_NON_ACTIONABLE` should not be counted as separate gates. They follow from the same non-actionable replay/occupancy result.

## Positive net versus positive utility

- 58 evaluations had positive net EV.
- 41 had positive risk-adjusted candidate utility.
- 17 positive-net evaluations became non-positive after canonical penalties.
- Uncertainty was high in all 58 best positive candidates, but it is soft context under `candidate-primary-risk-adjusted-v1`, not a hard veto. BUTTHOLE passed with uncertainty `0.8121033785661481`.
- OOR/inventory effects are incorporated in utility. Only one best-positive evaluation emitted `RANK_RANGE_SURVIVAL_WEAK`; no independent hard OOR veto caused an otherwise actionable candidate to fail.

## Evidence distance to pass

For the 54 range-survival-blocked best positive candidates, the target occupancy completeness threshold is 60%.

- Median coverage shortfall: **8.43 percentage points**.
- P95 shortfall: **39.53 percentage points**.
- Maximum shortfall: **45.79 percentage points**.
- One candidate had `60.70%` replay occupancy but still zero completed survival samples: it is blocked only by range-survival support, not replay actionability.

The stored ranking payload preserves the binary survival actionability state and survival probability, but not the raw per-candidate sample count. The source contract establishes that `samples === 0` is the blocking condition; it requires at least three future observations for each empirical anchor and only retains anchors whose occupancy is `COMPLETE`.

## One-gate-away cases

At evaluation level, two of the 57 blocked positive-net evaluations were one underlying gate away:

1. **BUTTHOLE**, `2026-09-02T03:04:44.276Z`, candidate `narrow-29-13-15-spot-skewed_y-1000`: net `+0.00008182765173923777 SOL`, utility `+0.000033164160791415314 SOL`, evidence actionable and fee calibrated, but zero survival samples. Its hypothetical candidate-primary adjustment would remain positive using the persisted global adjustment.
2. One evaluation was blocked only by replay/occupancy actionability rather than range support.

At candidate-alternative level, 32 blocked positive alternatives had one listed blocker, 643 had two, and 259 had three or more. The large two-gate count mostly represents the same missing occupancy history reported twice as range-survival insufficiency and replay evidence non-actionability.

## BUTTHOLE control

Pool: `EAf6shtt8QGJ7UiSRrDc6pzwXKEmb5s7tCCpSDe5zpzZ`

At `2026-09-02T03:06:15.978Z`, candidate `narrow-41-20-20-curve-skewed_y-1000` had:

- net EV: `+0.00009830382417759191 SOL`
- risk-adjusted ranking utility: `+0.00008066419118324289 SOL`
- candidate-primary adjusted EV: `+0.0000736795007948552 SOL`
- replay simulation: actionable; `COMPLETE` occupancy; 69.04% coverage
- range survival: actionable, probability 1
- fee calibration: `CALIBRATED`
- uncertainty: `0.8121033785661481` (soft context)
- OOR penalty: zero
- P3: `ENTRY_READY`; P4: `WAIT` solely because operational entry/capital authority was disabled.

The control proves that the existing contract can convert a dynamic pool without weakening any threshold.

## Strong but evidence-blocked candidates

The largest blocked utilities were not weak economic positives. They were repeated `ErwEeF8y8uLR7LkJcL3xRUuN1d8SrMLZJB92Ydq8vfdw` candidates whose candidate-specific historical windows were incomplete:

| UTC | Candidate | Net EV (SOL) | Utility (SOL) | Coverage | Independent blocker |
|---|---|---:|---:|---:|---|
| 01:18:41 | `defensive-99-63-35-curve-skewed_y-1000` | +0.0020763662 | +0.0010942227 | 52.46% | survival sample / occupancy |
| 01:37:43 | `narrow-63-33-29-curve-skewed_y-1000` | +0.0015839168 | +0.0008707324 | 52.31% | survival sample / occupancy |
| 02:14:43 | `narrow-49-22-26-curve-one_sided_y-1000` | +0.0015894945 | +0.0008672669 | 53.04% | survival sample / occupancy |
| 01:56:19 | `narrow-85-43-41-curve-one_sided_y-1000` | +0.0012125049 | +0.0005936243 | 54.73% | survival sample / occupancy |
| 04:04:17 | `narrow-51-21-29-curve-skewed_y-1000` | +0.0006271907 | +0.0003441300 | 54.93% | survival sample / occupancy |

These values are not execution-authoritative while the replay window is incomplete. They show that the actionability contract, rather than weak headline economics, is the immediate conversion limiter.

## Strategy pattern

Every positive-utility `CURVE/ONE_SIDED_Y` best candidate (16/16) was range-survival blocked. `CURVE/SKEWED_Y` produced the sole conversion (1/13); 12/13 were range-survival blocked. No strategy-specific economic defect is proven: the pattern tracks incomplete candidate-specific occupancy support.

## Marginal counterfactuals

These are read-only diagnostics using persisted values, not proposed policy changes.

- If direct replay continuity alone became actionable: **+0**. It already passed for every best positive candidate.
- If range-survival evidence alone became actionable: **+1 plausible additional P3 conversion**. The BUTTHOLE 03:04:44 candidate passed all other persisted actionability conditions.
- If replay/occupancy completeness alone became actionable: **+1 one-gate evaluation**; most other candidates would still lack survival samples.
- If fee calibration alone became actionable: **+0** independent conversions; its non-actionable form is downstream of replay actionability.
- If uncertainty alone passed: **+0**; it is not a hard gate in the current Candidate-Primary policy.
- If OOR/inventory risk alone passed: **+0** independent conversions in this cohort.

## Source-path evidence

- `packages/shadow/src/index.ts:prepareCandidateReplay` requires a candidate-covered replay spanning the 60-minute horizon.
- `packages/range-survival/src/index.ts:fitRangeSurvivalModel` admits only completed occupancy outcomes and requires at least three future samples per anchor.
- `packages/elapsed-occupancy/src/index.ts` defines the 60% coverage and 450-second maximum admissible-gap contract.
- `packages/candidate-simulator/src/index.ts` marks a simulation actionable only with valid scale, replay continuity, `COMPLETE` occupancy, and event-path evidence.
- `packages/candidate-ranking/src/index.ts` makes missing survival samples and non-actionable evidence non-actionable before ranking a local winner.

## Judgment

Classification: **EVIDENCE_MATURITY_DELAY / POLICY_CONSERVATISM, not a proven implementation defect**.

The system is correctly refusing to turn incomplete historical replay coverage into executable economics. The BUTTHOLE control demonstrates the collector and evidence path can meet the existing contract. However, actionability is currently the dominant conversion constraint: 54/58 positive-net best candidates lack a completed candidate-specific survival sample, and 56/58 fail replay-simulation actionability through incomplete occupancy coverage.

Smallest justified next action: **A — no policy change; continue observation and measure whether candidate occupancy coverage rises above the existing 60% contract.** If the same dynamic pools remain below that level despite sustained correctly scheduled collection, the next investigation should target historical active-bin/event-path completeness, not uncertainty, OOR, fee calibration, or Candidate-Primary economics.

## No-change confirmation

- Code changed: no.
- Database changed: no.
- Migration: none.
- Deployment/runtime changed: no.
- Global selector, collector, P3/P4/P7, strategy, and trading policy changed: no.
- New-entry authority: disabled.
- Transactions submitted: 0.
- Shadow or research lanes created: no.
