# LPForge raw replay actionability bottleneck forensic V1

Read-only forensic performed 2026-09-05 08:25 UTC against the Production
release `2645f1973a14ef7e0da35e389a77a5c2c79d563d`.  No runtime, code,
policy, configuration, or service state was changed.

## Finding

`FEE_CALIBRATION_RAW_REPLAY_NOT_ACTIONABLE` is a direct consequence of the
raw replay simulation having `evidenceActionable=false`; it is not an
independent fee-calibration veto.  The dominant and universal failing
predicate is occupancy completeness.  The raw source frames are fresh and
persisted, but their time gaps are routinely much greater than the immutable
450-second admissible-evidence gap.  The occupancy model correctly counts
only the first 450 seconds after each observation and classifies all later
time as unobserved.

This is a raw-replay evidence service-capacity mismatch, not unit scaling,
P4, range, P6, RPC outage, or a post-release source-code regression.

## Canonical contract

The production code paths are:

1. `packages/shadow/src/index.ts:116`, `prepareCandidateReplay`:
   filters frames at or before the decision; rebases the candidate at a
   historical anchor; requires candidate-bin coverage and a span of at least
   `horizonMinutes * 60,000`; otherwise emits
   `CANDIDATE_REPLAY_COVERAGE_INSUFFICIENT` or
   `CANDIDATE_REPLAY_CONTINUITY_INSUFFICIENT`.
2. `packages/candidate-simulator/src/index.ts:102-125`,
   `simulateCandidateEconomics`:
   `evidenceActionable = unitScaleValid && replayContinuous &&
   occupancyState === 'COMPLETE' && events.length > 0`.
3. `packages/elapsed-occupancy/src/index.ts`:
   an interval ends at the earlier of its successor, horizon end, or
   `observedAt + 450,000ms`; `COMPLETE` requires positive observed duration
   and coverage ratio at least `0.60`.
4. `packages/fee-evidence-calibration/src/index.ts`,
   `applyFeeEvidenceCalibration`:
   an inactionable raw simulation becomes `NOT_APPLIED` with
   `FEE_CALIBRATION_RAW_REPLAY_NOT_ACTIONABLE`, which then makes P3 evidence
   non-actionable (`NO_TRADE_EVIDENCE_NON_ACTIONABLE`).

Unit scale requires positive X/Y raw unit values, positive starting inventory
and target capital, finite values, and gross value movement bounded by five
times target capital.  Replay continuity is candidate-bin presence for each
positively weighted bin in every prepared frame.  Occupancy is a separate
time-coverage test; complete bin geometry does not fabricate time coverage.

## Cohort evidence

Window: 2026-09-05 06:16:03 UTC to 08:25 UTC.  The count rose naturally as
new decisions were recorded during the check.

| Predicate / outcome | Decisions | Notes |
| --- | ---: | --- |
| `FEE_CALIBRATION_RAW_REPLAY_NOT_ACTIONABLE` | 55 | 12 unique pools |
| occupancy incomplete | 55 / 55 | universal; median coverage 0.4641 |
| unit-scale invalid | 1 / 55 | same PiAs preparation failure, not a scale regression |
| replay-continuity insufficient | 1 / 55 | PiAs, fixed-bin preparation unavailable |
| no event-path events | 3 / 55 | early fAeDy evaluations; not dominant |
| multiple predicate failures | 4 / 55 | one PiAs plus three early fAeDy rows |
| actionable simulations | 0 / 55 | all nine variants were non-actionable |

Coverage distribution: p25 0.3089, median 0.4641, p75 0.5030, maximum
0.5764.  The required coverage is 0.60.  There is no separate raw-simulation
minimum sample-count predicate beyond having at least one event and the
occupancy contract; raw frame counts existed but were not temporally dense.

### Latest per-pool controls

| Pool | Decision | replay span min | raw frames | events | coverage | largest raw gap sec |
| --- | --- | ---: | ---: | ---: | ---: | ---: |
| 68C6…nyajR | 08:23:47 | 96.15 | 23 | 31 | 0.342 | 3237.3 |
| 7t477…fHYs | 08:23:18 | 72.15 | 35 | 35 | 0.556 | 991.3 |
| 3WY9…nDgY | 08:22:14 | 217.35 | 62 | 18 | 0.211 | 9778.3 |
| EAf6…5zpzZ | 08:17:31 | 60.28 | 27 | 45 | 0.576 | 971.3 |
| Ekm4…fyWr | 08:16:16 | 72.12 | 30 | 39 | 0.434 | 1924.3 |
| DchD…AThk | 08:14:16 | 80.07 | 34 | 23 | 0.498 | 1326.0 |
| 54sby…LX78e | 08:10:46 | 79.58 | 35 | 15 | 0.501 | 1260.1 |
| fAeDy…exNA | 08:08:41 | 62.08 | 27 | 4 | 0.483 | 1304.4 |
| 3C6q…YBXt | 08:07:45 | 84.12 | 22 | 4 | 0.355 | 2364.6 |
| piAs…xJk | 07:53:45 | 60.13 | 28 | 14 | 0.505 | 1111.7 |

Example: 7t477's 06:51:03--08:05:37 replay had six raw-frame intervals over
450 seconds, including 991.34 seconds.  The simulator correctly reported
coverage 0.5545 and `ACTIVE_TIME_OCCUPANCY_INSUFFICIENT`.  The latest raw
frame was fresh (about eight seconds before the decision); this is not a
freshness failure.

## Why current collection cannot mature these replays

`packages/active-candidate-evidence/src/index.ts` uses fair-slice economic
collection for `ACTIVE_CANDIDATE` pools.  Only economic lease holders are
placed in that slice; the protected continuity cap is two.  Recent capacity
records show one or two pools per completed pass while non-retained pools
experienced measured service gaps of roughly 0.95--1.04 million ms
(15--17 minutes).  Actual collector p95 per-pool duration was 64.57 seconds.

At the current raw feed cadence, a 15-minute gap contributes only 450 seconds
of observed time.  A repeating 900-second cadence can supply at most 50%
occupancy, below the 60% requirement.  With twelve pools and one read lane,
even twelve p95 reads need about 775 seconds before any operational margin;
the existing two-slot fair slice produces substantially worse observed gaps.

The current 60-minute horizon can also be expanded by
`prepareCandidateReplay`: it accepts the latest deterministic covered anchor
whose path spans *at least* the requested horizon and returns every subsequent
frame through decision time.  In the cohort this produced 60.13--217.35
minute simulation windows.  This is a window-alignment amplifier: it makes
coverage lower when the latest candidate-compatible anchor is older.  It is
not the primary cause of failure -- several exactly-near-60-minute windows
also fail -- but it must be addressed by any corrective design and regression
tests.

The tests explicitly document this current at-least-horizon behavior in
`tests/candidate-simulator-meteora-supply-regression.test.mjs` as the
"latest deterministic complete fixed-range horizon".  Changing it requires a
deliberate canonical replay-window decision, not an unnoticed threshold edit.

## Controls and release comparison

Recent P3-ready controls prove the strict contract is reachable:

| Control | Decision | span | occupancy coverage | result |
| --- | --- | ---: | ---: | --- |
| 3C6q…YBXt | 03:47:33 | 63.0 min | 0.6530 | raw replay actionable / P3 ENTRY_READY |
| 68C6…nyajR | 03:03:33 | 60.8 min | 0.7969 | raw replay actionable / P3 ENTRY_READY |
| 7t477…fHYs | 01:09:34 | 60.3 min | 0.6385 | raw replay actionable / P3 ENTRY_READY |

The current production SHA changed from `c5f26af7…` to `2645f197…` only in
P6 recovery, DB recovery records, PM2 registration, and reports.  No replay,
candidate-simulator, elapsed-occupancy, fee-calibration, collector, or range
source file changed.  The first observed large raw-frame gaps also began
before/at release transition.  Therefore there is no source-level
post-release replay regression.

## Classification and next canonical repair

Classification: `CONFIRMED_DEFECT` --
`OCCUPANCY_COMPLETENESS_BOTTLENECK` / raw-replay evidence service-capacity
contract mismatch.

The P3 drought is quantitatively explained by 55/55 raw replay vetoes failing
occupancy; the latest P3 ENTRY_READY remains 2026-09-05 03:47:33 UTC.  It is
not caused by weak unit scale, stale frames, missing inserts, SQL errors, or
P4 policy.  Raw replay actionability is reachable in this architecture when a
dense eligible window exists, but was not reachable for any candidate in this
post-release cohort.

No code was changed in this read-only forensic.  A safe corrective handoff
must preserve the 60% occupancy and 450-second evidence requirements.  It
should create an explicit, serviceable raw-replay evidence admission/queue
contract (or otherwise provide a raw-frame source that meets the required
cadence) before allowing a candidate to receive a final evidence-nonactionable
evaluation.  Candidates outside that serviceable cohort should be explicitly
`WARMING` / raw-replay-evidence-pending, not appear to have failed a replay
that the collector was never provisioned to maintain.  The repair must also
define whether replay is exactly horizon-bounded and add regressions for
overlong anchors, 450-second gaps, and the ten controls above.

Production was left unchanged and running.  At final check P7 was
`PRODUCTION / HEALTHY / NORMAL`, with `newEconomicActionAllowed=true`.
