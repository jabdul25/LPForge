# LPForge continuity capacity / eviction impact forensic V1

**Forensic cutoff:** 2026-09-02T14:40:30.862Z  
**Mode:** read-only  
**Discovery source:** `d7bc68dbb91ec75bb00e5e15399cd401b9934d94`  
**Code, policy, migration, deployment, entry authority, and transactions:** unchanged / none.

## Executive finding

The one-pool continuity lane is a proven **evidence-throughput constraint**. It
uses an oldest-first, pool-address tie-breaker rule rather than an economics,
coverage-shortfall, or expected-actionability rule. At the cutoff, 14 tracker
records had been capacity-evicted (the earlier 11-record snapshot was
superseded by three further evictions).

Nine evicted pools had positive candidate utility at the decision that created
their tracker record. Five of those had candidate occupancy coverage between
49.92% and 54.90%; one additional economically weak pool was already at
55.59%. They received from 17 to 108 seconds of tracking before eviction.

This proves fragmentation of potentially useful evidence collection. It does
not prove a specific additional ENTRY_READY decision, because the future
candidate range, market path, and candidate identity are not persisted as a
counterfactual future. The direct entry-yield effect is therefore **plausible,
not yet proven**.

The smallest conservatively safe capacity supported by the existing collector
accounting is **continuity cap 2**. With two economic leases and a 90-second
effective per-pool collection budget, it projects a 360-second continuity
revisit, below the 450-second hard gap. Cap 3 reaches 450 seconds with no
operational margin; cap 4 projects 540 seconds and is unsafe under the current
contract.

## Contract and implementation

- Economic lease cap: 2.
- Continuity tracking cap: 1.
- Continuity TTL: 60 minutes, equal to the replay horizon.
- RPC pool-read concurrency: 1.
- Replay requirement: 60-minute window, 60% occupancy completeness, maximum
  usable gap 450 seconds.
- Current collector projections: economic 180 seconds; one continuity lane
  270 seconds.

`packages/db/src/index.ts` defines the cap and TTL and implements
`reconcileEvidenceContinuityTracking()`. Eligible trackers are ordered by
`evidenceContinuityTrackingStartedAt ASC, pool_address ASC`; the first `cap`
are retained and every later eligible tracker is changed to `EVICTED` with
`EVIDENCE_CONTINUITY_CAPACITY_EVICTED`. No economic score, candidate utility,
coverage shortfall, or tracker age beyond FIFO is used in the decision.

`packages/active-candidate-evidence/src/index.ts` appends retained continuity
pools to the two economic collection targets. The collector derives its
conservative revisit calculation from the persisted 90-second effective
per-pool collection budget.

## Tracker state at cutoff

| State | Records |
|---|---:|
| TRACKING | 1 |
| CONSUMED_BY_ACTIVE_ECONOMIC_LEASE | 5 |
| NOT_REQUIRED | 1 |
| EVICTED | 12 |
| EXPIRED / COMPLETED / STALE | 0 |
| Records whose terminal reason is CAPACITY_EVICTED | 14 |

The state fields reside on the registry row and preserve the latest tracker
episode, not an append-only tracker-event stream. Accordingly, historic queue
length, every prior re-acquisition, and exact service share across overwritten
episodes are not reconstructable from persisted tracker telemetry. The
capacity-eviction count and per-record latest episode below are authoritative.

## Capacity-eviction cohort

`coverage` is the candidate-specific `occupancyCoverageRatio` at the P3
decision which opened the tracker. Required coverage is 60%.

| Pool / symbol | Utility | Net EV | Coverage | Tracker time before eviction | Classification |
|---|---:|---:|---:|---:|---|
| `3C6q…YBXt` STONK | -0.00001577 | -0.00000997 | 59.74% | 39s | non-positive; very close |
| `EBqu…cwFP` DICKBUTT | -0.00001589 | -0.00000999 | 15.12% | 51s | non-positive; far |
| `68C6…yajR` MANLET | +0.00007916 | +0.00016240 | 17.21% | 40s | positive utility; far |
| `8e7Q…Xq4g` Token | 0 | 0 | 0.00% | 19s | no actionable economics |
| `8LZK…XZkL` OTC | +0.00017788 | +0.00033875 | 16.26% | 37s | positive utility; far |
| `DchD…AThk` BULLSHIT | -0.00001571 | -0.00000995 | 55.59% | 18m 18s | non-positive; very close |
| `AFT9…MwLo` TOAD | +0.00000056 | +0.00001534 | 49.92% | 23s | positive utility; close |
| `5A15…JFQs` GTA6 | +0.00007413 | +0.00035673 | 23.69% | 23s | positive utility; far |
| `3WY9…nDgY` TripleT | +0.00001352 | +0.00001895 | 33.07% | 29s | positive utility; mid |
| `Ekm4…fyWr` OTC | +0.00003247 | +0.00006860 | 50.22% | 48s | positive utility; close |
| `FxPP…4T5X` MADE | -0.00001565 | -0.00000985 | 51.36% | 1m 48s | non-positive; close |
| `EAf6…5zpZ` BUTTHOLE | +0.00031692 | +0.00040905 | 54.90% | 33s | positive utility; close |
| `piAs…xJk` HeeHaw | +0.00023654 | +0.00028163 | 54.64% | 33s | positive utility; close |
| `ErwEe…vfdw` DOGE-1 | +0.00075958 | +0.00137894 | 38.39% | 17s | positive utility; mid |

Economic relevance: 9 positive-utility, 0 positive-net-only, 4 non-positive,
and 1 with no actionable economic candidate. Coverage buckets: 2 at or above
55%, 5 at 45–54.99%, 2 at 30–44.99%, and 5 below 30%.

Every evicted pool was removed far before its 60-minute TTL expired. Most
received no recorded continuity full-frame read before eviction; the longest
observed episode was Dch at 18m 18s. Thus eviction, not TTL expiry, produced
the post-admission interruption.

## Control: CTO (`54sbyULrreD9HBoV5wRWedeCBEw6gQ7VkdHW18rLX78e`)

CTO was retained from 12:51:55Z until its non-evidence terminal state at
13:51:23Z. It received 35 persisted pool/full-frame observation timestamps in
that interval. Its first P3 ENTRY_READY was at 13:08:30Z (about 16m 35s after
tracking began); three P3 ENTRY_READY decisions followed, all for CTO.

The control establishes that retained continuity service can supply the raw
frames needed for actionability. It does not establish that continuity alone
caused CTO's ENTRY_READY; CTO also had a positive, actionable candidate.

## Counterfactuals

Candidate occupancy is range-specific and a future range can change. Therefore
the database cannot prove that an evicted pool *would* reach 60% or become
ENTRY_READY. Conditional on its candidate geometry remaining stable and the
observed full-frame cadence continuing, the following positive-utility pools
are plausible coverage candidates: AFT9 (49.92%), Ekm4 (50.22%), EAf6
(54.90%), piAs (54.64%), ErwEe (38.39%), 3WY9 (33.07%), 5A15 (23.69%), 8LZK
(16.26%), and 68C6 (17.21%).

The highest-confidence *coverage* cases are EAf6, piAs, and Ekm4 because they
were within 5.1–9.8 percentage points of the 60% contract and were evicted in
under a minute. They remain only plausible actionability cases: their latest
persisted decisions still have non-actionable replay/fee-calibration evidence,
and no future range or market path may be invented in a read-only forensic.

Counterfactual additional P3 ENTRY_READY: high confidence 0; plausible 3
(EAf6, piAs, Ekm4); not provable 6 additional positive-utility evictions.

## Capacity simulation (economic cap 2, RPC concurrency 1 unchanged)

The collector's conservative effective-pool budget is 90 seconds. It currently
projects 180 seconds for two economic pools and 270 seconds for the combined
two-economic-plus-one-continuity slice.

| Continuity cap | Total targets | Conservative continuity revisit | Safety vs 450s | Eviction effect |
|---:|---:|---:|---|---|
| 1 | 3 | 270s | safe | observed 14 evictions |
| 2 | 4 | 360s | safe | avoids at least one of each two-arrival contention; materially reduces observed fragmentation |
| 3 | 5 | 450s | marginal; no margin | reduces more evictions but has no headroom for normal variance |
| 4 | 6 | 540s | unsafe | not supported without another throughput change |

Observed post-fix collector passes (213 samples) had a median elapsed time of
56.8 seconds, p95 83.8 seconds, and maximum 107.3 seconds, with at most one
continuity pool. These measurements are encouraging but do not override the
canonical 90-second conservative budget used by the scheduler. Cap 2 is the
only larger capacity supported without weakening the 450-second contract.

## Judgement

- **Is cap 1 a throughput constraint?** Yes. Fourteen immediate capacity
  evictions, including nine positive-utility pools, prove it.
- **Is cap 1 a proven entry-yield constraint?** Partly. It prevents broad
  evidence accumulation and leaves at least three plausible near-threshold
  positive cases unserved, but P3 ENTRY_READY remains counterfactual until the
  same range receives future evidence.
- **Did one slot favor CTO?** Yes for evidence service: CTO received 35 full
  frames while most evicted records received none. No causal claim beyond that
  allocation fact is warranted.
- **Is RPC=1 adequate for a larger cap?** Cap 2: yes under the existing
  conservative accounting. Cap 3: marginal. Cap 4: no.
- **Primary current bottleneck:** `CAP1_THROUGHPUT_CONSTRAINT`.
- **Secondary bottleneck:** candidate-range stability / range-specific replay
  evidence; it limits counterfactual certainty even if frames continue.
- **Next justified action:** **B. Raise continuity cap to 2**, with entry
  authority still disabled and a post-change cadence/coverage validation. This
  report does not implement that action.

## No-change confirmation

No source, database, migration, runtime, collector configuration, policy,
entry authority, position, transaction, shadow lane, or research lane was
changed. This report is an uncommitted forensic document.
