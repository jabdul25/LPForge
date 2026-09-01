# LPFORGE — Serviceable Collector Cap=2 Forensic

## Scope and cutoff

Read-only forensic. Cutoff: `2026-09-01T19:01:39.775Z`; latest capacity observation: `2026-09-01T19:00:51.067Z`.

No source, database, runtime, configuration, deployment, policy, entry authority, or service was changed.

The primary observation interval is post-M0069: `2026-08-31T23:19:28.954Z` through the cutoff. It contains 663 capacity observations. Interval-weighted calculations cap an unobserved gap at 180 seconds so an outage or missing observation is not treated as known slot occupancy.

## Exact cap semantics

The observed `2` is the dynamic **ACTIVE_CANDIDATE live-evidence lease/admission capacity**, not simply an RPC concurrency setting.

| Component | Runtime value | Effect |
| --- | ---: | --- |
| `LPFORGE_ACTIVE_COLLECTOR_MAX_CONCURRENT` | 1 | Concurrent pool reads per collection run |
| `LPFORGE_RPC_P3_MAX_RPS` | 3 | RPC capacity input |
| P95 pool collection estimate | 90 seconds (default) | Capacity input |
| Live-confirmation target coverage | 180 seconds (default) | Capacity input |
| Calculated serviceable/dynamic capacity | 2 | Maximum ACTIVE_CANDIDATE evidence leases |
| `LPFORGE_ACTIVE_COLLECTOR_MAX_POOLS` | 30 | Upper bound for collection slice, not the lease cap |

`calculateServiceableActiveCandidateCapacity` takes the minimum of RPC budget, cadence capacity, and the hard cap. With one concurrent reader, 90-second P95, and a 180-second coverage target, cadence capacity is two. `reconcileLiveEvidenceAdmission` writes that value as both `serviceable_capacity` and `dynamic_capacity`.

The collector then samples the admitted ACTIVE set with a deterministic rotating slice. With two active pools and a 60-second collector interval, one read per round is sufficient to revisit each within the existing 180-second target; this is separate from the two active leases.

Relevant paths:

- [active-candidate-evidence](/root/systems/LPForge/packages/active-candidate-evidence/src/index.ts:29) — capacity calculation and collection slice.
- [discovery runtime](/root/systems/LPForge/apps/discovery/src/main.ts:67) — effective environment/config wiring.
- [admission state machine](/root/systems/LPForge/packages/db/src/index.ts:2220) — transactional lease admission, release, waiting records, and capacity observation.

## Slot lifecycle

`QUALIFIED` Tier-A candidates enter `reconcileLiveEvidenceAdmission` on each collector pass. Eligible candidates are selected up to two slots, promoted to `ACTIVE_CANDIDATE`, and assigned a bounded 45-minute lease. ACTIVE leases remain while in protected dwell/Phase-3 consumption; they release on terminal Phase-3, timeout, or the failure limit. Release starts a 15-minute next-eligible cooldown. A challenger may replace an eligible incumbent only after the 15-minute dwell and a priority delta of at least 12.

Importantly, `qualified_waiting_count` is all non-admitted Tier-A targets. It includes pools in cooldown, pools released/terminal for the present pass, and QUALIFIED pools lacking a fresh discovery economic-priority value. It is **not** a count of immediately admissible pools.

## Utilization

| Metric | Result |
| --- | ---: |
| Average active leases, sample weighted | 1.564 |
| Average active leases, time weighted | 1.577 |
| Median / P95 active leases | 2 / 2 |
| Average qualified waiting | 8.481 |
| Time at 0/2 | 6.16% |
| Time at 1/2 | 30.00% |
| Time at 2/2 | 63.84% |
| Slot utilization | 78.84% |
| Queue-present time | 100.00% |
| Idle capacity while queue count was positive | 25,143.7 seconds / 36.16% |

The previously quoted approximately `1.11` active average is accurate for the earlier interval `2026-08-31T23:19:28.954Z` to `2026-09-01T07:00:00Z`: 1.101 sample-average active, 7.163 average waiting, and 73.36% time below two active with a positive queue. Later observations materially improved: from 08:00 UTC onward the sample-average active count was 1.879, and the current observations are 2/2 active with 11 waiting.

## Queue, turnover, and fairness

Current QUALIFIED queue: 11 pools. Its current persisted waiting-clock distribution is median 61h 10m, P95 211h 6m, maximum 223h 50m. Those clocks accumulate through repeated consideration and do not prove continuous eligibility because cooldowns are retained in the same payload.

Across the post-M0069 observation interval, 114 reconstructed active assignment sessions had:

| Residency metric | Duration |
| --- | ---: |
| Median | 445.2s |
| P95 | 2,755.2s |
| Maximum | 10,722.8s |

Observed active-slot time was concentrated in two pools:

| Pool | Active-slot share | Reconstructed assignments |
| --- | ---: | ---: |
| `3WY9…GnDgY` | 33.86% | 26 |
| `3GFt…PMZ5` | 32.84% | 16 |
| all other pools combined | 33.30% | 72 |
| EsR3…Qfs7 | 0.00% | 0 |

EsR3 is therefore **not** monopolizing the two dynamic evidence leases. It was evaluated by the global selector through a different eligible/evaluation path, but never held an observed active-capacity slot in this post-M0069 capacity cohort.

The admission policy is intentionally priority/dwell based, not round-robin fair. Only six explicit priority replacements were recorded. Long waiting clocks and concentrated slot time establish an **imbalanced** service outcome; strict scheduler starvation cannot be proven from the existing append-only observations because per-pass `admissionEligible`, cooldown, and release-reason values were not persisted for each waiting pool.

## Why underutilization occurred

The source path shows that a waiting pool can be counted while not admissible: `admissionEligible` requires no cooldown or release reason and either an existing ACTIVE state or fresh discovery economic priority. Consequently, a positive `qualified_waiting_count` does not obligate the scheduler to fill a vacant slot.

The capacity table records selected active/waiting addresses and priorities, but not each rejected target's `cooling`, `releaseReason`, or `admissionEligible` decision. Therefore historical idle capacity cannot be truthfully divided into exact per-second buckets such as cooldown versus missing fresh priority. This is an operational-observability limitation, not evidence that the selector failed to call the scheduler.

## WARMING and staleness relation

At the prior 27-cycle post-fix selector snapshot, 179 WARMING records were present. Joining each to the latest preceding capacity observation found:

| WARMING records | Count |
| --- | ---: |
| Pool was in an active evidence slot | 44 |
| Pool was in the dynamic waiting list | 0 |
| Pool was not in that capacity snapshot | 135 |

The dynamic two-slot cap therefore cannot by itself explain all selector WARMING states: global evaluation includes pools outside the dynamic ACTIVE/waiting snapshot. It can plausibly constrain evidence accumulation for the active/waiting universe, but causation for individual WARMING outcomes is not proven.

Historical `EXCLUDED_STALE` records from the earlier report cannot be reliably partitioned into active versus waiting from the current canonical candidate table: the old stale classification was not persisted as a stable per-record reason in this contract. No claim is made that staleness was caused by queue waiting.

## Read-only cap counterfactual

This is a queue-service upper bound, not an economic replay.

The queue was positive for all 69,528.8 bounded observed seconds. If every queued pool were otherwise admissible, cap 3 could supply up to one additional active slot for 69,528.8 slot-seconds (19.31 slot-hours), lowering the average queue by at most one pool: 8.481 to 7.481 (11.8%). Cap 4 could add up to two slots, 38.63 slot-hours, and lower it by at most two pools (23.6%).

Those bounds do **not** establish that candidates would mature or that stale risk would fall by those percentages. Cooldown, freshness, priority, and evidence-maturity gates may still prevent assignment. The 36.16% historical underutilization must be resolved before interpreting a larger cap as a complete remedy.

## Classification

- Cap saturation: `CAP_SATURATED_WITH_QUEUE` for 63.84% of the measured interval; `CAP_UNDERUTILIZED_DESPITE_QUEUE` for 36.16% under the table's broad queue definition.
- Is cap 2 material? **Yes, partly**: both slots are often full while a large queue remains.
- Is cap 2 the sole root cause of the 1.11 early utilization? **No**: the early underfill is governed by the admission/lease eligibility path.
- Scheduler/lease implementation defect: **not proven**. The code intentionally does not promote every QUALIFIED waiting row; the telemetry cannot reconstruct historical ineligibility exactly.
- Primary root cause: `MIXED` — a real capacity policy limit plus an admission/lease observability gap; no proven direct scheduler failure.

## No-change confirmation

- Code changed: no.
- Migration/deployment/restart: none.
- New-entry authority: disabled.
- Current position altered: no.
- Shadow or research lane created: no.
