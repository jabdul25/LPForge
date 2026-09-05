# LPFORGE live-evidence maturity throughput forensic v1

**Scope.** Read-only production forensic. No source, database, runtime, policy, deployment, or transaction state was changed. The stable forensic cutoff is **2026-09-01T20:52:57.639Z**. The cohort starts at the first `8f0ea62`-provenanced corrected-universe cycle, **2026-09-01T19:40:57.834Z** (72.0 minutes; 145 persisted global cycles).

## Executive finding

The immediate reason for most `WARMING` evaluations is exactly the rolling live-confirmation contract, not Candidate-Primary or a lack of trade activity. A pool needs a 10-minute, pool-specific live-evidence span with at least four valid live observations, a usable pre-window anchor, no gap of 7.5 minutes or more, and a latest observation no older than three minutes.

The contract is achievable under the current settings: GPRO (`3GFt...PMZ5`) satisfied `LIVE_CONFIRMATION_CONFIRMED` in 11 cycles, then reached Candidate-Primary and returned `NO_TRADE` on economics. It is not an impossible threshold and 72 minutes was long enough for a continuously serviced pool to mature.

The throughput problem is that two separate capacities disagree in practice:

```
admission/serviceable leases: 2 ACTIVE pools
collection slice per collector pass: 1 pool
actual collector-pass cadence: median 106 s (configured 60 s)
qualified queue: median 12 pools
```

`requiredActiveCandidateCollectionCapacity(2, 60 s, 180 s)` evaluates to one. The code therefore reads one of the two active pools per pass, and serial `await` work means those passes complete every 111.2 seconds on average rather than every configured 60 seconds. In the ideal two-pool round robin that is about 222 seconds per pool, already above the 180-second target coverage. The observed active-lease segments were usually much shorter than the ten-minute confirmation window (median 357.2 s); only 4 of 16 segments lasted at least ten minutes.

This is a **production implementation/throughput gap**, but the evidence does **not** support increasing the lease cap alone. With cap 3, the same formula still collects one pool per pass, worsening an individual pool's nominal cadence. With cap 2, increasing RPC concurrency alone cannot help because the collection slice has only one item.

## 1. Live-confirmation contract

Source: `packages/active-candidate-evidence/src/index.ts`, `assessHistoryMaturity` (lines 51-65); runtime wiring: `apps/discovery/src/main.ts:67,71`.

| Contract term | Effective value | Exact behavior |
|---|---:|---|
| Confirmation duration | 10 minutes | `LPFORGE_DISCOVERY_LIVE_CONFIRMATION_MINUTES` absent; runtime default is 10 (bounded 10-15). |
| Minimum live observations | 4 | `LPFORGE_DISCOVERY_LIVE_CONFIRMATION_MIN_OBSERVATIONS` absent; default 4 (bounded 2-60). |
| Maximum admissible gap | 450 seconds | `LPFORGE_DISCOVERY_LIVE_CONFIRMATION_MAX_GAP_MS` absent; default 450,000 ms. |
| Latest-evidence freshness | 180 seconds | `staleAfterMs`; a later sample is required before it ages past three minutes. |
| Search horizon | 17.5 minutes | The assessment uses the 10-minute window plus one max-gap before its start. |
| Anchor | Required | At least one sample must be at or before the 10-minute window start, with at least one in-window sample. |
| Consecutive observations | No separate counter | Continuity is enforced by the 450-second maximum gap. |

The Phase-3 consumer has an additional current-freshness check (`packages/operational-runtime/src/index.ts`): at least three live observations in 15 minutes, a latest observation within 180 seconds, and maximum gap under 450 seconds.

## 2. What counts as a live observation

Source: `refreshCurrentPhase3Evidence` in `packages/active-candidate-evidence/src/index.ts`.

One successful collector read obtains the Meteora API pool, on-chain pool, active-bin range, and recent transaction scan. It persists one `LIVE_OBSERVED` record containing a finite positive price, active bin, liquidity, fee/volume fields, provider, and completion timestamp. The persistence function rejects an invalid/non-positive price or invalid timestamp. A trade, non-zero volume, or non-zero fee is **not** required for this live-confirmation count.

Therefore every stored row in the table below is a counting observation. A failed/invalid read does not count; such failures are not represented as an observation. The production discovery logs for this cohort contained no collector/RPC failure, timeout, or rate-limit line matching the collector failure patterns.

## 3. Per-pool accumulation at cutoff

`current` is the rolling count exposed by the most recent maturity assessment, not a permanent counter. The history rows themselves remain persisted.

| Pool | Pair | Active lease time | Stored counting observations | Current rolling count | Contract progress | Per-pool median gap | p95 / max gap | Status |
|---|---|---:|---:|---:|---|---:|---:|---|
| `3GFt...PMZ5` | GPRO/WSOL | 36.8 min | 9 | 1 | 1/4; new rolling window | 371.6 s | 1,110.3 / 1,145.3 s | Previously confirmed; currently warming after old observations aged out. |
| `FxPP...4T5X` | MADE/WSOL | 29.2 min | 8 | 3 | 3/4 plus anchor | 172.0 s | 1,140.9 / 1,204.2 s | Warming: insufficient observations/pending. |
| `3WY9...nDgY` | TripleT/WSOL | 29.0 min | 9 | 4 | Count met; anchor pending | 152.4 s | 979.9 / 1,040.7 s | Warming: confirmation anchor pending. |
| `piAs...xJk` | HeeHaw/WSOL | 17.9 min | 10 | 3 | 3/4 plus anchor | 117.1 s | 1,088.8 / 1,163.6 s | Warming: insufficient observations/pending. |
| `5pjR...1HQo` | Jimothy/WSOL | 9.2 min | 1 | 1 | 1/4 | n/a | n/a | Warming: insufficient observations/pending. |
| `3S86...9vvd` | Cupsey/WSOL | 3.7 min | 1 | 1 | 1/4 | n/a | n/a | Warming: insufficient observations/pending. |

Across the cohort, 38 valid live observations were stored: 0.528 per minute. The global successful-read gap was median 107.7 seconds and p95 217.3 seconds. The 39 admission/collector snapshots were median 106.0 seconds apart, p95 179.3 seconds, versus the configured 60-second interval.

An uninterrupted two-pool rotation at the *observed* collector cadence would be roughly one observation per pool every 222 seconds. Its best-case live confirmation is approximately 11.1 minutes (rather than the 10-minute contract minimum). GPRO's actual first successful observation at 19:46:31 and first confirmed global result at 20:03:30 was about 17 minutes.

## 4. Persistence, expiry, and lease behavior

Live observations are written to `market.candidate_market_observations` with an idempotent source hash. Neither a lease release/reacquisition nor a process restart deletes them. The DB lease timeout is 45 minutes (`ACTIVE_EVIDENCE_LEASE_TIMEOUT_MS`); the normal incumbent protection dwell is 15 minutes (`LIVE_EVIDENCE_MIN_ACTIVE_DWELL_MS`).

The apparent reset is semantic, not data loss: `assessHistoryMaturity` only considers the rolling confirmation horizon. Once a sample falls beyond that horizon, it no longer helps establish the current anchor/count/freshness. This is why GPRO could have nine persisted observations and only one usable current rolling observation at the cutoff.

Observed membership segments nevertheless were short: 16 segments, median **357.2 s** (5.95 min), p95 **1,064.5 s** (17.74 min), max **1,449.1 s** (24.15 min); only 4 segments reached ten minutes. Releases after durable Phase-3 `NO_TRADE`/`ENTRY_READY` are intentional. One recorded priority replacement obeyed the dwell guard (FxPP -> piAs after 1,058,892 ms / 17.65 min). The short observed segments are therefore not evidence of a DB reset, but they are insufficiently stable for most pools to complete the rolling confirmation span.

## 5. WARMING and economic outcome decomposition

The extended, consistent cohort contains 223 `WARMING`, 9 `NO_TRADE`, and 1 `INCLUDED` normalized pool outcomes. The warming reasons are:

| Exact reason set | Count |
|---|---:|
| `ENTRY_LIVE_CONFIRMATION_INSUFFICIENT_OBSERVATIONS` + `ENTRY_LIVE_CONFIRMATION_PENDING` | 210 |
| `HISTORY_MATURE` + `LIVE_CONFIRMATION_CONFIRMED`, followed by `OPERATIONAL_EVIDENCE_MATURITY_PENDING` | 11 |
| `OPERATIONAL_ECONOMIC_EVIDENCE_STALE` | 2 |

`3GFt...PMZ5` owns all 11 confirmed rows. It also produced two local `NO_TRADE` outcomes after reaching the economic evaluator. Thus market economics can reject a mature pool, but market activity is not the cause of the dominant live-observation WARMING state.

## 6. Lease-cap and RPC analysis

Source: `packages/active-candidate-evidence/src/index.ts:15-32,112-122`; admission state machine: `packages/db/src/index.ts:2220-2280`; collector loop: `apps/discovery/src/main.ts:71`.

| Metric | Measured |
|---|---:|
| Dynamic ACTIVE evidence lease cap | 2 |
| RPC pool-read concurrency | 1 |
| Configured collector interval | 60 s |
| Active leases, mean / median / p95 | 1.744 / 2 / 2 |
| Time at 0/2, 1/2, 2/2 | 3.72% / 16.15% / 80.14% |
| Slot utilization | 88.21% |
| Qualified waiting, mean / median / p95 / max | 11.590 / 12 / 12.1 / 13 |
| Time at 2/2 while queue > 0 | 80.14% |
| Time below 2/2 while queue > 0 | 19.86% |
| Largest active lease-holder share | GPRO 51.63% of wall-clock slot time |

The cap is saturated with a persistent queue, so it limits diversity/queue throughput. It is not the only issue: the admission cap of 2 is followed by a separate calculation of **collection-slice capacity**. At two active pools, a 60-second configured interval and 180-second target coverage yield `ceil(2 * 60 / 180) = 1`. `selectActiveCandidateCollectionSlice` therefore provides only one pool to `bounded(..., maxConcurrentPoolReads, ...)`. With one selected item, RPC read concurrency 1 is not currently a binding parallelism limit.

The actual collection-pass cadence is 106 seconds median, not the 60 seconds used by that calculation. With two leases and one selected pool each pass, actual expected coverage is roughly 212 seconds before any processing variance, greater than the three-minute target. This is the direct source-path mismatch:

```
apps/discovery start loop awaits collect()
  -> nextCollection = Date.now() + configured interval after collect finishes
  -> actual pass cadence includes network/backfill work
  -> required collection slice still uses configured interval only
```

## 7. Counterfactuals (read-only)

These are service-throughput estimates, not candidate-economic forecasts.

| Scenario | Collection slice under current formula | Expected consequence |
|---|---|---|
| cap 2, RPC 1 (current) | 1 | Two leases share one serial read. Ideal observed-cadence confirmation is about 11.1 minutes; actual rotation made it slower. |
| cap 3, RPC 1 | 1 | More pools may hold leases, but each gets approximately one of every three collector passes. At the observed pass cadence, the earliest regular four-observation span is about 16.7 minutes. This does not cure the one-item slice. |
| cap 4, RPC 1 | 2 | The formula first permits two selected pools, but the single reader serializes them. Actual pass duration would need measurement; it could delay the next pass and cannot be assumed beneficial. |
| cap 2, RPC 2 | 1 | No material direct effect: the slice still contains one pool. |
| cap 3/4 with matching reader capacity | 1 / 2 | Could improve queue service only after the collection-slice/cadence mismatch is resolved and API/RPC load is validated. |

The current observed mature-pool throughput is **1 distinct live-confirmed pool / 1.2 h = 0.83 pools/hour** (GPRO), with **0 ENTRY_READY**. Projecting a trustworthy mature-pool throughput for the queue is not possible because most observed leases end before the rolling window completes and because actual collector cadence is slower than configured.

## 8. Root cause and safest next action

**Primary bottleneck: MIXED — lease-cap/queue pressure plus collector scheduling/slice throughput.**

**Secondary bottleneck: lease residency/rotation relative to the ten-minute rolling confirmation window.**

**Not the primary bottleneck:** market trade activity (not required to count a valid observation), observation persistence (facts persist), or current RPC concurrency alone (only one work item is selected).

**Production architecture gap: YES, mixed.** The active-lease serviceability calculation advertises capacity 2, while the collector selects only one pool based on an assumed 60-second cadence that actual sequential work does not achieve. The median observed lease segment (5.95 minutes) is shorter than the 10-minute confirmation span. This prevents reliable per-pool maturity throughput even though an exceptional uninterrupted pool can mature.

**Smallest evidence-supported next change: H — fix collector scheduling/capacity accounting first.** It should base the collection slice on actual completion cadence or otherwise guarantee that every active lease receives observations within the existing 180-second target. This recommendation preserves the live-confirmation policy, cap, strategy, and economics. It is not a recommendation to increase cap 2 or RPC concurrency in isolation.

## No-change confirmation

Runtime evidence was read from the production release/provenanced global-cycle rows for `8f0ea62ac2ede2316dab5c34c1af056002fc855a`. New-entry authority remained disabled. Production and execution services remained online; eight historical lifecycles are `SOL_SETTLED`; no submission attempt was recorded during this cohort. No position, database row, policy, service, migration, deployment, shadow lane, or research lane was altered.
