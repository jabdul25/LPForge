# LPForge global selector zero-candidate forensic

## Scope

Read-only forensic of deployed `global-pool-selection-v1` at source
`1f5061f1c0b37420269920385e4f77a151f51dee`.  No code, policy, database,
configuration, runtime, entry-authority, position, plan, or accounting state was
changed.  Cutoff: 2026-08-31 22:55 UTC.

## Executive finding

`GLOBAL_NO_TRADE` is not evidence that the market has no valid economic
opportunity.  The production probes produced 28 `ENTRY_READY` per-pool outcomes
in the cohort, and eight of those became valid global candidates.  However, no
cycle had two valid candidates simultaneously.

The primary cause is a global-selector integration limitation:

1. The selector's candidate-fact loader only reads a recommendation/thesis whose
   `decision_at` was written during the exact global cycle.
2. An operational probe that exits early as `WARMING` (usually because fresh
   event-path/maturity evidence is unavailable) persists an operational cycle,
   but no recommendation/thesis row.
3. The global loader then returns no row and the selector records the pool as
   `EXCLUDED_STALE`/`GLOBAL_CANDIDATE_METRICS_INCOMPLETE`, rather than retaining
   the durable operational reason such as `OPERATIONAL_EVIDENCE_MATURITY_PENDING`.
4. Because the selector requires a fact row for every evaluated pool, any such
   absent row changes the whole cycle to `GLOBAL_COVERAGE_INCOMPLETE` and it
   fails closed, even if one other pool has a valid candidate.

This is a selector evidence-contract/observability limitation, not a change to
Candidate-Primary, P3, P4, P7, or fee-productivity policy.

## Cohort and global-cycle statistics

All available cycles were analyzed (36; fewer than the requested 50).

| Metric | Result |
|---|---:|
| Global winners | 0 |
| `GLOBAL_NO_TRADE` | 36 |
| `GLOBAL_COVERAGE_INCOMPLETE` | 36 |
| Zero-candidate cycles | 28 |
| One-candidate cycles | 8 |
| Multi-candidate cycles | 0 |
| Fully evaluated eligible universe | 35 / 36 |
| Partial evaluation cycles | 1 / 36 |
| Pools skipped | 1 |

Eligible universe size ranged from five to eight pools.  The configured policy
has five static Production pools; discovery was enabled and supplied up to three
additional Tier-A pools.  The latest cycles evaluated the full dynamic universe
except for one timeout of AeUf.

## Coverage and capacity

Global-cycle duration:

| Metric | Duration |
|---|---:|
| Mean | 56.6 s |
| Median | 47.8 s |
| p95 | 108.8 s |
| Maximum | 180.3 s |
| Configured deadline | 120 s |
| Recorded operator timeout/deadline failures | 1 |

No per-pool start/end timing is persisted, so an exact per-pool mean/median/p95
cannot be reconstructed without manufacturing telemetry.  Capacity is not the
dominant reason for no competition: 35 of 36 cycles evaluated every eligible
pool.  It is nevertheless a secondary implementation concern: a cycle reached
180.3 seconds despite the nominal 120-second deadline, and one AeUf probe timed
out.  That timeout affected one pool only and does not explain the cohort-wide
zero/multi-candidate result.

## Candidate formation results

There were 222 evaluated-pool records in the cohort:

| Durable operational outcome | Count | Meaning |
|---|---:|---|
| `WARMING` | 171 | Early fail-closed operational result; no recommendation/thesis persisted. |
| `NO_TRADE` | 22 | Candidate-Primary evaluated the pool and rejected it. |
| `ENTRY_READY` | 28 | Per-pool Candidate-Primary/P3 winner existed. |
| No persisted operational cycle | 1 | The timeout-affected pool. |

Global selector representations of the same records were:

| Global candidate state | Count |
|---|---:|
| `EXCLUDED_STALE` | 194 |
| `NO_VALID_CANDIDATE` | 20 |
| `INCLUDED` | 8 |

The `EXCLUDED_STALE` count must **not** be read as 194 independently proven
stale feeds.  Most correspond to the 171 durable `WARMING` results with no
recommendation row for the global loader to read.  The global record therefore
collapses distinct upstream reasons into one misleading label.

### Primary durable reasons

Reason-code counts overlap and therefore are not additive:

| Reason | Count |
|---|---:|
| `OPERATIONAL_EVIDENCE_MATURITY_PENDING` | 161 |
| `ENTRY_LIVE_CONFIRMATION_INSUFFICIENT_OBSERVATIONS` | 22 |
| `CANDIDATE_PRIMARY_NO_LOCALLY_ACTIONABLE_WINNER` | 19 |
| `OPERATIONAL_ENTRY_NOT_READY` | 19 |
| `OPERATIONAL_CAPITAL_ALLOCATION_ZERO` | 19 |
| `FEE_CALIBRATION_NORMALIZATION_SCALE_CREDIBILITY` | 15 |
| `OPERATIONAL_ECONOMIC_EVIDENCE_MISSING` | 8 |
| `FEE_CALIBRATION_RAW_REPLAY_NOT_ACTIONABLE` | 7 |
| `CANDIDATE_PRIMARY_RISK_ADJUSTED_EV_NON_POSITIVE` | 3 |
| `OPERATIONAL_ECONOMIC_EVIDENCE_STALE` | 2 |
| `CANDIDATE_REPLAY_CONTINUITY_INSUFFICIENT` | 1 |

Thus the requested category classification is:

- `EVIDENCE_FRESHNESS_FAILURE`: dominant; 171 `WARMING`, principally maturity
  and live-confirmation evidence, plus 8 missing and 2 stale event-path cases.
- `ECONOMIC_EV_FAILURE`: 22 real per-pool `NO_TRADE` outcomes; 19 had no locally
  actionable Candidate-Primary winner and three had non-positive risk-adjusted EV.
- `P4_FAILURE`: not a global exclusion cause.  P4 `WAIT` candidates are retained
  by the global selector as designed; P4 remains downstream.
- `RANGE_CONSTRUCTION_FAILURE`, `STRATEGY_VALIDATION_FAILURE`, and a distinct
  fee-productivity hard-gate failure: none proven in this cohort.
- `OTHER`: 20 `ENTRY_READY` records lacked `capital_value` in the global
  candidate representation and were rejected as
  `GLOBAL_CANDIDATE_METRICS_INCOMPLETE`.  This is a data-contract/plumbing issue,
  not an economic rejection.

## Pool-universe quality

The five static policy pools and up to three discovery pools were repeatedly
probed.  The dominant state was not a discovery/prefilter exclusion: it was
post-probe `WARMING` evidence maturity.  Examples from the cohort:

- 2VHM: 35 evaluations, all `WARMING`.
- AeUf: 35 evaluations, 34 `WARMING`, one timeout/no durable cycle.
- EsR3: 35 evaluations, 25 `ENTRY_READY` and 10 `NO_TRADE`.
- 8Csg: 35 evaluations, 30 `WARMING`, three `ENTRY_READY`, two `NO_TRADE`.

This supports insufficient currently mature evidence across most of the eligible
universe, rather than a collector-cap failure.  It does not prove the pools are
economically poor once mature evidence exists.

## Multi-candidate competition

No cycle had Pool A and Pool B as valid global candidates simultaneously.
Therefore there is no winner/runner-up economic spread to report.  The eight
included candidate records were isolated one-candidate observations:

- Five EsR3 records, including P4 `ENTRY_READY` candidates.
- Three 8Csg records, with P4 `WAIT` retained upstream as intended.

Each correctly failed closed because every other evaluated pool was missing a
fresh global candidate fact, so the cycle was marked incomplete.

## Old versus global comparison

An exact `OLD WOULD ENTER` counterfactual cannot be reconstructed from this
cohort without fabricating evidence.  The former deterministic entry selector is
not run in parallel, and the old selected-pool decision plus its downstream P4/P7
authorization were not persisted at the same cutoffs.  Furthermore, the current
one-position slot is occupied and entry dispatch is intentionally disabled.

The only defensible same-cutoff comparison is that 28 per-pool P3 outcomes were
`ENTRY_READY`, while the global selector produced zero executable global winners
because no complete multi-pool candidate set existed.  This establishes a global
evidence-contract difference, but not a valid count of historical old entries.

## Root-cause classification

Primary: **OTHER — global candidate persistence/coverage contract limitation**.

Contributing factors:

1. **FRESHNESS / evidence maturity**: most evaluated pools are correctly
   `WARMING` due to unavailable fresh mature/event-path/live-confirmation evidence.
2. **SELECTOR STRICTNESS**: an absent recommendation row is treated as stale and
   makes coverage globally incomplete, rather than recording a complete
   per-pool no-candidate result with its canonical operational reason.
3. **POOL UNIVERSE**: the current five-to-eight pools contain only one mature
   candidate at a time in the observed window.
4. **CAPACITY**: secondary only; one timeout and one over-deadline cycle are
   observed, but evaluation coverage was otherwise complete.

## Recommendations (not implemented)

Do not enable entry authority.  Before reconsidering activation, a separate
approved implementation decision would need to address the evidence contract:
persist or expose a canonical per-pool evaluation result for every probe,
including `WARMING`/`NO_TRADE`, and distinguish evidence freshness from absent
candidate formation.  It should also account accurately for cycle deadlines and
add per-pool timing telemetry.  No threshold, Candidate-Primary, P3/P4/P7,
cooldown, or policy change follows from this forensic alone.

## Current-position safety and no-change confirmation

`BcHk2btyymBVz8W5Yk2pMhCpz23ZvAV8k2MzvUgqL2J1` remains OPEN in EsR3 with
30,000,000 lamports initial capital.  There are zero pending transaction plans.
No close, rebalance, execution action, accounting change, lifecycle mutation,
deployment, migration, or code change occurred during this investigation.
