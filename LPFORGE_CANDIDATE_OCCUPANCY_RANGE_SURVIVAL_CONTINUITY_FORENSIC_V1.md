# LPForge — Candidate Occupancy / Range-Survival Continuity Forensic V1

## Scope

- Read-only forensic. No source, database, deployment, policy, collector, selector, or runtime change was made.
- Production source/runtime: `5ea5c0d5a1b529b593d93bbec90a9a583528d56e`.
- Detailed evidence cutoff: `2026-09-02T06:44:22.666Z`.
- Positive-candidate population: 65 latest-best positive-net or positive-utility mature evaluations after the corrected collector deployment. This later snapshot supersedes the prior 58-positive-evaluation analysis; it is not combined with it.

## Result

The primary reason candidate occupancy remains below 60% is **incomplete raw active-bin/bin-frame continuity for the pool in the relevant rolling window**, not a general failure to reuse raw history across ranges. Selected candidate geometry also changes frequently, which is a secondary range-churn/design effect and reduces the chance that any one shape has a completed empirical survival outcome. No rolling-window, cache-loss, or broad candidate-history-mapping implementation defect is proven.

At the cutoff:

| Test on the 65 best positive candidates | Count |
|---|---:|
| Candidate replay occupancy below 60% | 63 |
| Raw trailing-60-minute active-bin history at or above 60% | 3 |
| Raw trailing-60-minute bin-frame history at or above 60% | 3 |
| Raw active-bin history at or above 60% while candidate coverage remained below 60% | 1 |

Thus, 62 of the 63 below-threshold candidate windows coincide with insufficient raw active-bin continuity. The single mismatch is an isolated mapping/replay-shape case, not evidence of a systemic failure to credit available pool history.

## 1. Range-survival contract

Source paths:

- `packages/elapsed-occupancy/src/index.ts`
- `packages/range-survival/src/index.ts:fitRangeSurvivalModel`
- `packages/shadow/src/index.ts:prepareCandidateReplay`
- `packages/candidate-simulator/src/index.ts`
- `packages/candidate-ranking/src/index.ts`

The contract is unchanged:

- requested occupancy/replay horizon: **60 minutes**;
- minimum completeness: **60%**;
- expected evidence cadence: **60 seconds**;
- maximum admissible observation gap: **450 seconds**;
- each empirical survival anchor requires at least **three** future active-bin observations;
- only an anchor whose elapsed occupancy is `COMPLETE` contributes a range-survival sample.

`60% completeness` is **covered elapsed time divided by the requested 60-minute duration**, not the proportion of observations whose active bin is inside the range. The elapsed-occupancy implementation sorts usable timestamped observations, carries each state forward only until the next observation, the horizon end, or the 450-second admissible-gap cap, whichever is earliest, and sums those covered intervals. `COMPLETE` requires covered duration / 60 minutes >= `0.60`.

Survival probability is distinct: among completed historical anchors, it is the fraction whose subsequent active-bin path stays inside the rebased candidate range for the horizon. A candidate can have complete data but poor survival, or incomplete data with no computable survival sample. The dominant present failure is the latter.

## 2. Raw evidence, identity, and reuse semantics

The relevant raw inputs are loaded by `packages/db/src/index.ts:loadOperationalHistory`:

- pool-level active-bin timeline: `protocol.pool_snapshots(pool_address, observed_at, active_bin_id)`;
- full bin-frame timeline: `protocol.bin_snapshots(pool_address, bin_id, observed_at, liquidity_supply, amount_x, amount_y, ...)` joined to the active-bin snapshot at the same timestamp;
- event path: `protocol.swap_events(pool_address, observed_at, start_bin_id, end_bin_id, ...)`.

The live collector writes these raw pool-scoped observations; range survival does **not** depend on a candidate-specific persisted observation cache. Historical data is loaded over the canonical four-hour operational-history window and recomputed for the current decision.

Candidate identity is `family-width-lowerHalf-upperHalf-strategy-orientation-capitalFraction*1000` (`packages/rangeforge/src/index.ts`). Absolute range geometry uses current lower/upper/center bins. For survival, Rangeforge supplies relative lower/upper offsets; `fitRangeSurvivalModel` reanchors those offsets to each historical active bin.

Consequences:

- identical relative shapes reuse the same raw pool history across active-bin movement;
- an absolute range shift caused solely by active-bin movement does not reset a candidate-specific cache, because there is no such cache;
- a changed width, asymmetry, strategy, orientation, or capital fraction is a different candidate shape and is separately simulated;
- overlapping absolute ranges do not inherit a cached result, but both are evaluated against the same raw pool timeline.

**Raw history reused across range changes: PARTLY.** It is reused for reanchored survival/replay construction, but a different candidate shape must independently satisfy the same candidate-covered-frame and survival conditions. No evidence shows accidental cache eviction, lease-rotation reset, or process-restart loss of occupancy evidence.

## 3. Raw-history health

Representative four-hour source-history checks demonstrate that an occasional eligible 60-minute segment can exist even when the overall pool timeline is sparse:

| Pool | Raw active-bin snapshots | Distinct observed minutes | Four-hour elapsed coverage | Largest raw gap | Event-path condition |
|---|---:|---:|---:|---:|---|
| ErwEe / DOGE-1 | 97 | 37 | 31.16% | 1,682s | 199 swaps across 20 minutes; 26.09% coverage; largest gap 2,221s |
| BUTTHOLE | 94 | 45 | 42.26% | 4,350s | 196 swaps across 35 minutes; 41.56% coverage |
| OTC | 136 | 50 | 39.55% | 2,019s | 20 swaps across 8 minutes; 17.22% coverage; largest gap 2,729s |

The four-hour figures are descriptive, not a substitute for the candidate’s exact 60-minute window. The exact trailing-60-minute test is the decisive result: only 3/65 best-positive candidate decision windows had raw active-bin and bin-frame coverage at or above 60%.

Raw active-bin producer health is therefore **PARTIAL/GAPPY** for the evaluated opportunity set. Event-path data exists for the examined positive pools and direct replay continuity passed for the earlier 58/58 best-positive set; it is not the independent dominant blocker. The failure is temporal continuity of active-bin/frame evidence at the candidate decision window.

## 4. Candidate-specific replay construction

`prepareCandidateReplay` walks historical bin frames backward, rebase-adjusts the current candidate to a historical anchor active bin, and seeks a contiguous candidate-covered sequence spanning 60 minutes. Every frame in the sequence must have the candidate’s weighted bins present, nonzero liquidity supply, and usable token amounts. It then simulates with swap events from that anchor onward.

The survival builder separately creates historical anchor outcomes at the configured stride, requires at least three future active-bin samples, and retains only occupancy-complete outcomes. Ranking makes `samples === 0` non-actionable as `RANGE_SURVIVAL_EVIDENCE_INSUFFICIENT`.

This explains the correlated reason family:

- `RANGE_SURVIVAL_EVIDENCE_INSUFFICIENT`
- `CANDIDATE_REPLAY_COVERAGE_INSUFFICIENT` / non-actionable replay
- downstream `FEE_CALIBRATION_RAW_REPLAY_NOT_ACTIONABLE`
- downstream `RANK_EVIDENCE_NON_ACTIONABLE`

They mainly describe the same missing continuous raw evidence, not four independent policy vetoes.

## 5. ErwEe / DOGE-1 deep dive

Pool: `ErwEeF8y8uLR7LkJcL3xRUuN1d8SrMLZJB92Ydq8vfdw`.

- Positive candidate cycles: 17 over 5.515 hours.
- Distinct selected candidate shapes: 17.
- Distinct selected absolute ranges: 17.
- Boundary changes between successive positive cycles: 16 (about 3.08/hour).
- Mean center-bin movement between successive selected candidates: 4.56 bins.
- Median selected-candidate lifetime in the positive decision records: one decision interval; no exact selected positive shape persisted for 60 minutes.

The highest observed utility was the `2026-09-02T01:18:41Z` candidate `defensive-99-63-35-curve-skewed_y-1000`:

- net EV: `+0.0020763662 SOL`;
- risk-adjusted utility: `+0.0010942227 SOL`;
- candidate occupancy: 52.46%;
- raw trailing active-bin coverage: 54.25%;
- survival samples: zero / `RANGE_SURVIVAL_EVIDENCE_INSUFFICIENT`.

Across ErwEe’s positive cycles, candidate occupancy was generally 47–55%, with corresponding raw active-bin coverage approximately 43–55%. Examples: 52.31% / 54.11% at 01:37, 53.04% / 54.47% at 02:14, 54.93% / 52.99% at 04:04, and 47.28% / 47.24% at 05:07. Gaps in the relevant 60-minute raw timeline reached roughly 941–1,291 seconds, beyond the 450-second admissible limit.

**ErwEe is primarily blocked by RAW_HISTORY_GAP, with HIGH selected-range churn secondary.** Its range changes do not explain the near-equality of raw and candidate occupancy; the raw timeline itself is normally below 60%. Churn reduces the chance of a stable shape acquiring a completed empirical survival outcome, but it is not evidence that history is being discarded.

## 6. BUTTHOLE control

Pool: `EAf6shtt8QGJ7UiSRrDc6pzwXKEmb5s7tCCpSDe5zpzZ`.

At `2026-09-02T03:06:15.978Z`, `narrow-41-20-20-curve-skewed_y-1000` succeeded with:

- candidate replay occupancy: 69.04% / `COMPLETE`;
- range-survival probability: 1 with usable sample support;
- calibrated fee evidence;
- net EV: `+0.00009830382417759191 SOL`;
- risk-adjusted utility: `+0.00008066419118324289 SOL`;
- P3: `ENTRY_READY` (P4 remained `WAIT` only because entry authority/capital was disabled).

Two minutes earlier, BUTTHOLE had a different candidate shape with 60.70% occupancy and actionable replay/fee calibration but zero survival samples. That is the isolated raw-history-complete/candidate-survival-incomplete class in this forensic. The next shape obtained usable survival support and converted. It demonstrates both that the 60% contract is reachable and that a one-off shape-specific survival result is not a system-wide mapping loss.

## 7. Stable-range, mapping-loss, and window tests

- Exact selected positive candidate ranges stable for >=60 minutes: **0**.
- Stable >=60-minute selected candidate ranges still below 60%: **0** (no qualifying stable range exists in the selected-positive record).
- Raw active-bin history >=60% while selected candidate coverage <60%: **1**.
- Counterfactual candidates that would reach >=60% simply by crediting already-available raw pool history: **at most 1/65** under the exact-range replay rules.

The 60-minute rolling-window implementation uses timestamp ordering, a valid state at/before the window start, capped carry-forward intervals, horizon-end closure, and UTC millisecond parsing. Duplicate timestamps with contradictory active bins are rejected as ambiguous rather than silently counted. No off-by-one boundary loss, timezone issue, or rolling-window-anchor error was found in the implementation or persisted evidence.

## 8. Range churn across major positive pools

Selected positive candidate geometry is high churn, but that conclusion must be interpreted correctly: it describes Candidate-Primary’s current optimum, not an evidence-reset key.

| Pool | Positive candidate cycles | Distinct selected shapes | Boundary changes | Span | Churn classification |
|---|---:|---:|---:|---:|---|
| ErwEe | 17 | 17 | 16 | 5.515h | HIGH |
| FxPP | 14 | 14 | 13 | ~7h | HIGH |
| Dch | 10 | 10 | 9 | ~6.13h | HIGH |
| piAs | 5 | 5 | 4 | ~6.77h | HIGH |

High churn is associated with low candidate-specific coverage, but the stronger direct observation is that raw coverage is itself below the requirement for almost all candidate windows. This evidence supports a range-churn design effect, not a proof that Candidate-Primary should be changed.

## 9. Root-cause classification

Primary classifications for the 65 best positive candidate evaluations:

| Classification | Count | Interpretation |
|---|---:|---|
| `RAW_HISTORY_GAP` | 62 | Candidate and raw trailing window both below 60%; missing/capped raw intervals are the direct loss. |
| `CANDIDATE_HISTORY_MAPPING_GAP` | 1 | Raw timeline completed but a particular candidate shape lacked a survival outcome; isolated. |
| Already coverage-complete / not classified as coverage failure | 2 | Includes the BUTTHOLE control and another raw-complete decision; not evidence of a general loss. |

Range churn is a secondary cross-cutting factor in the raw-history-gap group; it is not double-counted as an independent primary failure. No exact selected positive range was stable long enough in this sample to test an allegedly broken long-lived candidate cache.

## Judgment and next action

**Production-gap classification: MIXED — data-continuity/producer availability is the material issue; no candidate-replay or rolling-window implementation defect is proven.**

- The 60% threshold itself is **not proven wrong**.
- Coverage fails because ranges keep changing: **PARTLY**, but raw history gaps are the dominant direct reason.
- Raw history available but not credited: **NO broadly; one isolated case only**.
- Stable candidates failing despite sufficient history: **NO evidence** in this cohort, because no exact selected positive candidate survived >=60 minutes.
- Candidate replay builder health: **HEALTHY/PARTIAL** — correct source-scoped replay logic, constrained by incomplete raw input.

The smallest justified next action is **B — fix/investigate raw active-bin history producer continuity** (including the pool-service/retention path that determines whether raw active-bin and full bin frames exist continuously). This is an investigation/fix recommendation only; no change was made here. Do not alter the 60-minute window, 60% requirement, Candidate-Primary, range policy, or entry authority on this evidence alone.

## No-change confirmation

- Code changed: no.
- Database changed: no.
- Migration: none.
- Deployment/runtime change: none.
- Entry authority: disabled.
- Transactions submitted: 0.
- Current position altered: no.
- Global selector, collector, discovery, and trading policy changed: no.
- Shadow lanes created: no.
- Research lanes created: no.
