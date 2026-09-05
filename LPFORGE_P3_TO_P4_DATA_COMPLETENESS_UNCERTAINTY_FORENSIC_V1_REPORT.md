# LPForge P3 → P4 Data Completeness / Uncertainty Forensic V1

Status: HEALTHY_STRICT_POLICY

## Scope and cohort

The cohort is the 50 most-recent persisted P3 `ENTRY_READY` evaluations:
2026-09-04 06:26:28 UTC through 2026-09-05 03:47:33 UTC.

| Metric | Value |
|---|---:|
| P3 ENTRY_READY | 50 |
| P4 ENTRY_READY | 10 |
| P4 WAIT | 31 |
| P4 REJECT | 9 |
| P3 → P4 ENTRY_READY conversion | 20.0% |
| P3-ready completeness p25 / median / p75 | 0.600 / 0.600 / 0.800 |
| P3-ready uncertainty p25 / median / p75 | 0.793 / 0.817 / 0.841 |
| P4-ready completeness median (range) | 0.740 (0.600–0.925) |
| P4-ready uncertainty median (range) | 0.805 (0.784–0.905) |

The latest P4 `ENTRY_READY` was 7t477 at 2026-09-05 00:09:04.668 UTC.
This is direct Production proof that the current evidence architecture can
produce completeness of at least 0.60 and P4-ready decisions.

## Exact P4 completeness calculation

Source: `packages/market-context/src/index.ts`, `contextFor`; consumed by
`packages/entry-features/src/index.ts`, `computeEntryTimingFeatures`.

For each 5m, 15m, and 1h horizon, market observations form non-overlapping
covered time intervals. An observation contributes from its timestamp through
its bounded `resolutionMs` (minimum 1 second, maximum 15 minutes), clipped to
the horizon. Completeness is `coveredMilliseconds / horizonMilliseconds`.

P4 uses exactly:

```text
dataCompleteness = min(completeness5m, completeness15m, completeness1h)
```

There are no weights, fees, replay occupancy, reclaim, volatility, or
continuity-observation-count terms in this value. The lowest time horizon is a
deliberate hard quality bound. P4 hard-blocks when it is below 0.60.

## Exact uncertainty calculation and important correction

Source: `packages/opportunity/src/index.ts`, `estimateOpportunityEconomics`.

```text
forecastUncertainty = clamp(
  1 - (1 - evidenceUncertainty)
      * (1 - regimeAmbiguityPenalty)
      * (1 - outcomeDispersion)
)
```

`evidenceUncertainty` comes from the event-path economic estimate;
`regimeAmbiguityPenalty` combines entropy, top-two margin, transition mass,
flapping and short stability; `outcomeDispersion` measures disagreement among
admissible candidate simulations.

It is not the inverse of completeness. Completeness is short-horizon
market-time coverage; uncertainty is an economics/regime/simulation forecast.

The current P4 implementation (`packages/entry-intelligence/src/index.ts`) no
longer blocks on the displayed 0.72 uncertainty threshold. It explicitly sets
`uncertaintyNoLongerBlocking: true`; the old threshold is retained as a
diagnostic (`removedBlockerReason`). This is confirmed by 10 real current
P4-ready controls with uncertainty 0.784–0.905. Therefore an assertion that
P4 currently requires uncertainty <= 0.72 is not true of the deployed
implementation; no threshold was changed in this forensic.

## Exact incident reconstruction

### 3C6q…YBXt — 2026-09-05 03:47:33.873 UTC

| Component | Value | Contribution / finding |
|---|---:|---|
| 5m market-time coverage | 0.236243 | Binding completeness component; below 0.60 |
| 15m market-time coverage | 0.676526 | Passes |
| 1h market-time coverage | 0.935798 | Passes |
| Evidence uncertainty | 0.422500 | Economic estimate input |
| Regime ambiguity penalty | 0.512000 | Material uncertainty driver |
| Outcome dispersion | 0.312597 | Material uncertainty driver |
| Forecast uncertainty | 0.806276 | Diagnostic only in current P4 |
| Support/reclaim strength | 0.103492 | Below 0.48; `WAIT_RECLAIM_NOT_CONFIRMED` |
| Volatility expansion risk | high; structure expansion 0.871732 | `WAIT_VOLATILITY_EXPANSION` |

The last 5m was sparsely covered by 30-second live snapshot intervals, with
zero-duration event rows not contributing coverage; it was not a stale or
cross-pool read. P4 correctly emitted `ENTRY_DATA_QUALITY_BLOCK`, plus the
reclaim and volatility waits.

### 68C6…nyajR — 2026-09-05 03:03:33.639 UTC

| Component | Value | Contribution / finding |
|---|---:|---|
| 5m market-time coverage | 0.125463 | Binding completeness component; below 0.60 |
| 15m market-time coverage | 0.542932 | Also below 0.60 |
| 1h market-time coverage | 0.904344 | Passes |
| Evidence uncertainty | 0.447500 | Economic estimate input |
| Regime ambiguity penalty | 0.469625 | Material uncertainty driver |
| Outcome dispersion | 0.293374 | Material uncertainty driver |
| Forecast uncertainty | 0.792936 | Diagnostic only in current P4 |
| Support/reclaim strength | 0.666003 | Passes |
| Volatility expansion risk | 0.678254 / MODERATE structure | Does not produce a volatility wait |

P4 correctly emitted `ENTRY_DATA_QUALITY_BLOCK`. Its short 5m and 15m
market-time coverage, not wallet state or continuity identity, was insufficient.

## P4 attrition in the 50-decision cohort

Reason overlap is expected: a candidate can have several independent waits.

| P4 reason | Count |
|---|---:|
| `ENTRY_DATA_QUALITY_BLOCK` | 9 |
| `WAIT_RECLAIM_NOT_CONFIRMED` | 30 |
| `WAIT_IMMEDIATE_OOR_RISK` | 12 |
| `WAIT_VOLATILITY_EXPANSION` | 6 |
| `WAIT_FLOW_NOT_RECOVERED` | 1 |
| `WAIT_REGIME_UNSTABLE` | 1 |

The dominant P3-to-P4 attrition reason is reclaim confirmation, followed by
immediate-OOR risk. The direct completeness hard block accounts for 9/50.

## Historical controls and reachability

Recent current-architecture P4 controls include 7t477 (00:09:04), Ekm4
(14:14:13), 54sby (13:30:32), 6xBK (09:56:09), and ErwEe (09:48:52) on
2026-09-04/05. They had completeness of 0.600–0.925 and all emitted
`ENTRY_TIMING_APPROVED` with 0.03 SOL allocated where P4 was operationally
ready.

Thus current Production can reach completeness >=0.60. It does not currently
enforce uncertainty <=0.72, and the actual controls demonstrate that this
metric does not determine P4 pass/fail. The question of changing that policy
is separate and was not acted upon.

`LIVE_CONFIRMATION_CONFIRMED` proves a protected 10-minute continuity episode;
it does not by itself guarantee a contiguous market-time interval in the
rolling 5m/15m P4 windows. P3 deliberately requires historical maturity plus
fresh live observations, while P4 additionally requires current market-window
coverage and timing quality. This is an intentional P3/P4 contract, not an
episode-binding defect.

3C6q and 68C6 did not remain valid P3-ready candidates long enough to establish
a later P4-ready progression: subsequent cycles returned to WARMING or became
`NO_TRADE` due to non-actionable replay/fee evidence. No stale, misbound,
pre-anchor, or prematurely reset evidence was found in the two incident
snapshots.

## Conclusion

The observed 0.125–0.236 values are legitimate rolling market-time coverage
facts. The current architecture is strict but demonstrably reachable; its
recent P3→P4 conversion rate is 20%. No completeness, uncertainty, evidence
retention, freshness, or episode-binding implementation defect was proven.
No code, policy, service, or configuration was changed.
