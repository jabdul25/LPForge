# LPForge — Raw Active-Bin / Full-Frame History Producer Continuity Forensic V1

## Scope and cohort

- Read-only forensic. No source, database, deployment, policy, service, collector, or runtime change was made.
- Runtime/source: `5ea5c0d5a1b529b593d93bbec90a9a583528d56e`.
- Primary continuity cohort: `2026-09-01T23:19:04.782Z` through `2026-09-02T06:44:22.666Z`, matching the 65-positive-candidate occupancy forensic.
- Collector telemetry was also checked through `2026-09-02T08:20:10.655Z` to confirm the finding remained current.
- New-entry authority remained disabled; no transaction was submitted.

## Result

There is **no evidence that successful active-pool reads fail to persist full bin frames**, that unchanged state is deduplicated into artificial gaps, or that timestamp alignment fabricates the observed gaps. The raw producer performs a paired pool snapshot/full-frame write after each successful active-pool read.

The material loss is architectural: for dynamic pools, detailed active-bin and full-bin-frame history is produced only while the pool is in `ACTIVE_CANDIDATE`. A pool can become eligible for Phase 3 through backfilled market/live-confirmation evidence, receive a P3 terminal result, and be returned to `QUALIFIED` with a 15-minute retry cooldown. During the off-lease interval no raw frame history is produced. The replay contract nevertheless requires 60-minute frame occupancy with at least 60% elapsed coverage.

This makes raw-frame coverage a function of lease episodes, not merely collector reliability. It explains why the collector can be healthy at 2/2 while most candidates still have 43–55% raw occupancy.

## 1. Exact production pipeline

```
ACTIVE_CANDIDATE registry state
  -> reconcileLiveEvidenceAdmission() selects serviceable leases
  -> collectActiveCandidateEvidence()
  -> collector slice selection (completion-aware, active candidates only)
  -> parallel API pool read + RPC getPool + RPC getBinsAroundActive + transaction scan
  -> refreshCurrentPhase3Evidence()
  -> insertPoolSnapshot() -> protocol.pool_snapshots
  -> insertBins()         -> protocol.bin_snapshots
  -> insertCandidateMarketObservations() / fee observations
  -> loadOperationalHistory()
  -> candidate replay + range-survival use pool_snapshots/bin_snapshots/swap_events
```

Relevant source paths:

- `apps/discovery/src/main.ts:collect` and its completion-based collector loop;
- `packages/active-candidate-evidence/src/index.ts:collectActiveCandidateEvidence`;
- `packages/active-candidate-evidence/src/index.ts:refreshCurrentPhase3Evidence`;
- `packages/db/src/index.ts:insertPoolSnapshot`, `insertBins`, `insertSwapEvent`, and `loadOperationalHistory`;
- `packages/db/src/index.ts:reconcileLiveEvidenceAdmission` and `recordPostEvidenceEvaluationOutcome`.

`collectActiveCandidateEvidence` fetches the current API pool, RPC pool state, bins around the active bin, and recent transactions. Only after those reads succeed does it call `refreshCurrentPhase3Evidence`, which writes the pool snapshot and bins. An exception marks the collection result `DEGRADED`; it does not produce a collector `PASS`.

Raw event ingestion is separate and event-dependent: recent signatures are scanned and decoded on each active read; historical backfill can also decode prior swaps. A quiet pool need not produce new `swap_events`, but lack of swaps was not the primary occupancy loss in this cohort.

## 2. Expected cadence and frame shape

Runtime configuration:

- `LPFORGE_ACTIVE_COLLECTOR_INTERVAL_MS=60000`;
- `LPFORGE_ACTIVE_COLLECTOR_MAX_CONCURRENT=1`;
- dynamic serviceable ACTIVE capacity: 2;
- live-confirmation revisit target: 180 seconds;
- replay’s admissible gap: 450 seconds.

For an active dynamic pool, the intended pool-snapshot and full-frame cadence is one successful collection per collector pass. There is no separate lower-frequency frame producer. The full-frame request is `getBinsAroundActive(pool, binRadius)`; the radius derives from the maximum executable range width.

Observed raw frames were complete for this configured scope:

| Raw-frame test, through 08:20 UTC | Result |
|---|---:|
| Distinct persisted frame timestamps | 2,692 |
| Minimum bins per frame | 297 |
| Median bins per frame | 297 |
| Maximum bins per frame | 297 |
| Frames below 297 bins | 0 |
| Pool snapshots with a corresponding frame within 30 seconds | 2,692 / 2,692 |

297 is the configured candidate-relevant frame width. No evidence shows a partial bin-array read, a silent frame skip, or missing candidate-relevant arrays after a successful raw write.

## 3. Collector service versus persistence

Collector-pass telemetry since the primary cohort began, through 08:20 UTC:

| Metric | Value |
|---|---:|
| Capacity/collector ticks | 513 |
| Active-pool selection opportunities | 975 |
| Successful collector pool reads | 965 |
| Non-success opportunities | 10 (1.03%) |
| Median completed collector pass | 18.980s |
| P95 completed collector pass | 72.548s |

The raw protocol tables do not carry a collector-pass ID, so 965 telemetry successes and 2,716 raw timestamp pairs are not a one-to-one audit key. They arise from different telemetry surfaces and cannot safely be subtracted. The source path is nevertheless decisive: a collector `PASS` occurs only after the snapshot/frame persistence routine completes. The paired-timestamp audit found no partial full-frame production.

The 10 non-success opportunities are not enough to explain 62/65 range-occupancy failures. Error detail is not durably attached to each pass, so they cannot be split reliably into RPC timeout, provider, or persistence causes retrospectively. PM2/DB evidence did not establish a material 429/5xx/timeout pattern in this cohort.

## 4. Dynamic producer coverage by mature pool

The table uses the 15 mature-pool set from the matched 06:44 UTC cohort. `Raw/frame coverage` is elapsed coverage over the entire 7h25m primary span, with each observed state carried for at most the canonical 450 seconds. It is not the candidate’s favorable in-range survival probability.

| Pool | ACTIVE ticks | Pool snapshots | Frame timestamps | Raw/frame coverage |
|---|---:|---:|---:|---:|
| Ekm4LYkihEdQgZx2UReDMJ3eCDDjExPQLG94WfWmfyWr | 76 | 210 | 210 | 50.9% |
| piAsMQ549AVA7bxdD3bH9ZH8ztrQJWCR6vpUARLYxJk | 72 | 206 | 206 | 50.3% |
| ErwEeF8y8uLR7LkJcL3xRUuN1d8SrMLZJB92Ydq8vfdw | 69 | 196 | 196 | 49.8% |
| FxPPZGPiTNYzgdMkNgAkA8QRZjNxurjBo7JgPt9z4T5X | 68 | 189 | 189 | 46.0% |
| DchDNJc71s11WaHzJRjzW4qG6qbYC8ySzbBMcFmnAThk | 68 | 196 | 196 | 45.0% |
| EAf6shtt8QGJ7UiSRrDc6pzwXKEmb5s7tCCpSDe5zpzZ | 64 | 164 | 164 | 43.7% |
| fAeDy2q7ZjZZZFt6Q1FtbHaCU5dtLEPmYcwcwfAexNA | 61 | 177 | 177 | 34.1% |
| 3C6qVymTAwWNKCSspmd1qbUH9avaqhsjgW2yntvEYBXt | 57 | 142 | 142 | 33.5% |
| AFT9ZhYVHMRQrnntMYnqVrKvVrAxpaspCEMBXQNVMwLo | 40 | 101 | 101 | 21.4% |
| 3WY9N19nTtPSqrbWTeaFn2HfJ9MfdyLRSrRvy97GnDgY | 30 | 88 | 88 | 17.9% |
| 5A15QUc6kMxw9dsVpVUv6ZdTTBeyWBN2scyy1MEQJFQs | 38 | 96 | 96 | 17.4% |
| 3GFtPrTvwzvWBHhL1wrMttnUKSgyDfW7zDuyJ6WDPMZ5 | 20 | 52 | 52 | 15.2% |
| 68C62WPYiiNZxprbuaMj2ULXpiTDKcs5xsX7kBGnyajR | 39 | 113 | 113 | 14.9% |
| DoQbAjidahwZMDembBpTNhnV1PmFnFY1W3hXET222kka | 28 | 81 | 81 | 12.4% |
| 2TD1fMPg2w7Hjt8bASSdxi92YFNQFgvdznqVApe3NGpn | 26 | 78 | 78 | 10.8% |

Snapshot and frame timestamp counts are equal for every mature pool. Therefore the coverage loss occurs before (or between) collection opportunities, not in the frame-persistence step.

## 5. Lease-bound-history finding

For dynamically discovered pools, raw active-bin/frame production is **lease-bound: YES**. A merely `QUALIFIED` pool is not passed to the active collector. `market.candidate_market_observations` can contain historical API backfill and live-observed market data, but historical backfill does not synthesize `protocol.bin_snapshots` or a historical full-frame timeline.

This creates two different evidence lanes:

| Evidence lane | Primary producer | Can be backfilled | Needed for |
|---|---|---|---|
| Historical market + live confirmation | API/OHLCV, candidate market observations, active reads | Yes, partly | `MATURE` / live confirmation and general economic context |
| Active-bin + full bin-frame replay | Active collector while `ACTIVE_CANDIDATE` | No equivalent full-frame reconstruction | Candidate replay, occupancy, and empirical range survival |

A pool may therefore be `LIVE_CONFIRMATION_CONFIRMED` and receive Candidate-Primary/P3 evaluation while its raw frame history is still materially short of the 60-minute, 60%-complete replay requirement.

Lease behavior makes this visible in the capacity timeline:

- the lease timeout is 45 minutes;
- the minimum active dwell is 15 minutes when it remains locked;
- after a durable P3 `ENTRY_READY` or `NO_TRADE`, `recordPostEvidenceEvaluationOutcome` immediately returns the pool to `QUALIFIED` and applies a 15-minute next-eligible cooldown;
- raw snapshot/frame collection stops when it is no longer `ACTIVE_CANDIDATE`.

The observed ErwEe episodes were short, typically 2.1–3.5 minutes, separated by roughly 15–20 minutes. At its strong `01:18` positive candidate, the active episode began at `01:15:49`; P3 evaluated after only about 2.5 minutes of that episode. This is entirely insufficient to create 36 minutes of new raw occupancy needed for a 60% 60-minute window. Re-admission later preserves old rows, but the off-lease holes remain and are capped at 450 seconds.

Thus a newly admitted pool with no usable pre-lease raw frames has a mathematical maximum raw coverage far below 60% at early P3 evaluation. A 10-minute live-confirmation span alone supplies no more than 16.7% direct observed duration in a 60-minute replay window; it cannot meet the replay contract without prior compatible frame evidence.

## 6. ErwEe versus BUTTHOLE

### ErwEe / DOGE-1

`ErwEeF8y8uLR7LkJcL3xRUuN1d8SrMLZJB92Ydq8vfdw`

- Primary-cohort lease-active tick share: 69 active ticks.
- Raw pool snapshot coverage over the 7h25m span: 49.8%.
- Full-frame coverage: 49.8%; every pool snapshot had a frame counterpart.
- Candidate-specific 60-minute replay coverage in strong positive cycles: roughly 43–55%.
- Relevant raw gaps: commonly 941–1,291 seconds, exceeding the 450-second cap.
- Primary gap source: long off-lease / unobserved periods, not failed writes or partial frames.

### BUTTHOLE

`EAf6shtt8QGJ7UiSRrDc6pzwXKEmb5s7tCCpSDe5zpzZ`

- Primary-cohort lease-active tick share: 64 active ticks.
- Raw/frame coverage over the complete 7h25m cohort: 43.7%.
- Successful candidate replay coverage: **69.04%** in its selected historical window.
- Why it succeeded: it had a favorable local cluster of densely persisted frame reads in the candidate’s usable replay segment, including the sustained 02:56–03:06 UTC service period and usable preceding observations. The 450-second capped carry-forward accounting yielded one eligible historical replay/survival outcome.

BUTTHOLE’s success does not contradict the architecture finding. Whole-cohort coverage was also sparse; it happened to contain one candidate-compatible 60-minute segment. ErwEe’s relevant candidate windows did not.

## 7. Deduplication, timestamps, and bin arrays

- `protocol.pool_snapshots` has no unchanged-state deduplication: every successful call inserts a timestamped row.
- `protocol.bin_snapshots` uses `ON CONFLICT(pool_address, bin_id, observed_at) DO NOTHING`; it only prevents exact duplicate rows at the same timestamp. It does not discard later identical market states.
- Elapsed occupancy carries a valid observation forward to the next observation only up to 450 seconds. A snapshot at 10:00 followed by a 10:10 observation is credited for 450 seconds, then correctly becomes unobserved; this is intentional contract behavior, not a dedupe artifact.
- Pool and bin reads are parallel RPC operations, so their individual `observed_at` values can differ by milliseconds/seconds. All 2,692 inspected pool snapshots had a frame within 30 seconds. No timestamp skew produced the multi-minute holes.
- All frames had 297 bins, matching the configured evidence width. No evidence of missing required bin arrays or silently truncated full-frame reads was found.

## 8. Proven-gap tests

| Test | Result | Evidence |
|---|---|---|
| Successful collector read -> missing persistence | NOT PROVEN | `PASS` follows persistence in source; no partial frame pattern observed. Per-read IDs are not persisted, so exact one-to-one audit is unavailable. |
| Persisted raw data -> replay not credited | PARTLY, isolated | 1/65 raw-complete candidate case lacked a survival result; no broad mapping loss. |
| Unchanged-state dedupe creates artificial gaps | NO | Pool snapshots are not deduped; elapsed accounting intentionally caps a long unobserved interval. |
| Lease architecture creates a 60% coverage ceiling | YES | Detailed frames stop off-lease, while P3 can run after a short active interval; observed ErwEe episodes are 2–3.5 minutes. |
| Full frame silently skipped | NO | Every observed frame had 297 bins; paired pool/frame coverage was complete within 30 seconds. |
| Timestamp accounting creates artificial >450s gaps | NO | Large gaps align with off-lease/absent collection intervals, not pool-vs-bin timestamp skew. |

## Root cause and next action

Primary root cause: **LEASE_CAP_ARCHITECTURE_CONSTRAINT / lease-bound full-frame evidence production**.

Secondary condition: **raw timeline discontinuity caused by terminal P3 release and retry cooldown**, amplified by the two-slot capacity/qualified queue. This is not an RPC, full-frame, persistence, or deduplication defect.

This is a proven **Production architecture gap**: admission/live-confirmation permits Candidate-Primary evaluation before the system can normally have accumulated the separate raw full-frame history that candidate replay requires. It is a contract mismatch between:

```
producer: detailed frames only while ACTIVE
replay:   >=60% coverage over the preceding 60 minutes
```

The smallest justified next action is **E — fix the lease-bound evidence architecture**. The appropriate design work is to reconcile eligibility/evaluation timing with durable raw-frame continuity, without weakening the 60-minute/60% replay contract. Raising cap=2 or RPC concurrency alone would not remove the mismatch and is not justified by this forensic.

## No-change confirmation

- Code changed: no.
- Database changed: no.
- Migration: none.
- Deployment/runtime change: none.
- New-entry authority: disabled.
- Transactions: 0.
- Policy changed: no.
- Shadow/research lanes: none.
