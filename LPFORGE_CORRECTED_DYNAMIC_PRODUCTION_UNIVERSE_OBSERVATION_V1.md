# LPForge corrected dynamic Production universe observation v1

Status: COMPLETE (read-only observation)

Forensic cutoff: 2026-09-01T20:25:51.187Z. The primary cohort is every
persisted global-selection cycle whose `source_commit` is
`8f0ea62ac2ede2316dab5c34c1af056002fc855a`; it starts at
2026-09-01T19:40:57.834Z. No pre-fix cycle is included in the primary
metrics.

## Runtime and safety

- Runtime release: `8f0ea62ac2ede2316dab5c34c1af056002fc855a`; migration head
  M0069 was present.
- P7 was running decision cycles, with `daemon_plan=OBSERVE_ONLY` for all 91
  cohort P7 decisions. Its current control record was `PRODUCTION / CRITICAL /
  BLOCK / EMERGENCY_ONLY`, with `newEconomicActionAllowed=false`; the explicit
  entry-disable environment control was `true`.
- Execution was online and reporting `AWAITING_AUTONOMOUS_DECISION`; no
  transaction was submitted by this observation.
- Active positions: 0 (all eight persisted lifecycles are `SOL_SETTLED`).
- Active execution journal states: 0; unknown submissions: 0; derived active
  reconciliation debt: 0; one superseded reconciliation-history row remains
  audit-visible and nonblocking. Terminalization debt: 0.

The P7 health/drift block is separate from the nonblocking BcH historical
reconciliation row. It did not stop global-cycle persistence in this cohort.

## Cycle continuity and breadth

91 cycles persisted over 44m 53s. Cycle gap: mean 30.055s, median 30.016s,
p95 35.682s, maximum 45.764s. Evaluation duration: mean 9.054s, median
9.582s, p95 13.295s, maximum 20.753s. There were no incomplete-coverage or
deadline reason codes, and no P7 `RECOVER_ONLY` decision in the cohort.
Selector continuity therefore passes.

Per-cycle evaluation breadth was:

| Eligible / evaluated pools | Cycles |
| --- | ---: |
| 0 / 0 | 8 |
| 1 / 1 | 18 |
| 2 / 2 | 65 |

All 91 cycles had zero valid global candidates: 91 `GLOBAL_NO_TRADE`, zero
sole-candidate selections, and zero competitive global winners.

## Dynamic evaluation universe

No static policy pool was present in the corrected cohort's global pool
candidate records. The six evaluated pools are all non-policy pools and pair
against WSOL.

| Pool | Pair label | Evaluated outcomes | Share | WARMING | NO_TRADE | ENTRY_READY |
| --- | --- | ---: | ---: | ---: | ---: | ---: |
| 3GFtPrTvwzvWBHhL1wrMttnUKSgyDfW7zDuyJ6WDPMZ5 | GPRO/WSOL | 45 | 30.41% | 44 | 1 | 0 |
| FxPPZGPiTNYzgdMkNgAkA8QRZjNxurjBo7JgPt9z4T5X | MADE/WSOL | 45 | 30.41% | 44 | 1 | 0 |
| piAsMQ549AVA7bxdD3bH9ZH8ztrQJWCR6vpUARLYxJk | HeeHaw/WSOL | 23 | 15.54% | 20 | 3 | 0 |
| 5pjRzUQan6bYynQERLK499fq48LiD5ryZrf9adZX1HQo | Jimothy/WSOL | 18 | 12.16% | 18 | 0 | 0 |
| 3WY9N19nTtPSqrbWTeaFn2HfJ9MfdyLRSrRvy97GnDgY | TripleT/WSOL | 10 | 6.76% | 9 | 1 | 0 |
| 3S86WtfvZroac8tGH3h1bKZmPK7uaZWNCg2U6kZH9vvd | Cupsey/WSOL | 7 | 4.73% | 7 | 0 | 0 |

The exact global-candidate state distribution is 142 WARMING and 6 NO_TRADE;
there are no REJECTED, ENTRY_READY, or EXCLUDED_STALE records. The dominant
WARMING reasons are `OPERATIONAL_EVIDENCE_MATURITY_PENDING` (142),
`ENTRY_LIVE_CONFIRMATION_INSUFFICIENT_OBSERVATIONS` (131), and
`ENTRY_LIVE_CONFIRMATION_PENDING` (131). The six NO_TRADE records are
Candidate-Primary local non-actionability, not a global-ranking rejection.

## Comparison with the static-seeded baseline

| Metric | Pre-fix static-seeded cohort | Corrected dynamic-only cohort |
| --- | ---: | ---: |
| Cycles | 110 | 91 |
| Distinct evaluated dynamic pools | not applicable | 6 |
| Distinct candidate-producing pools | 3 | 0 |
| ENTRY_READY records | 41 | 0 |
| Single-candidate cycles | 35 (31.82%) | 0 (0.00%) |
| Multi-candidate cycles | 3 (2.73%) | 0 (0.00%) |
| Largest ENTRY_READY share | 75.61% EsR3 | not defined |
| Largest sole-candidate share | 80.00% EsR3 | not defined |

Static concentration has been removed from this evaluation universe: EsR3 and
the other four static policy pools received no automatic evaluation. This is
not yet evidence that candidate diversity improved. The apparent reduction in
single-candidate concentration is entirely because the corrected cohort has
no valid candidate at all. Competition has not increased; it is presently
unobserved.

## Dynamic lease cap and queue

The measured dynamic serviceable capacity was two active evidence leases; the
pool-reader concurrency setting was one. For capacity observations bounded to
the same cutoff (23 observations, 44m 12s weighted coverage):

- Average active leases: 1.739; median 2; p95 2; slot utilization 86.96%.
- Time at 0/2: 5.83%; 1/2: 11.35%; 2/2: 82.82%.
- Qualified queue: mean 11.826, median 12, p95 12.9, maximum 13.
- Time at 2/2 with a qualified queue: 82.82%.
- Time below 2/2 with a qualified queue: 17.18% (7m 36s); this is not a
  persistent scheduler-idle pattern.

Lease service was rotated among six dynamic pools. Active-slot share was
GPRO 30.87%, MADE 29.74%, HeeHaw 15.33%, Jimothy 11.80%, TripleT 7.58%, and
Cupsey 4.68%. The top two therefore held 60.61% of active-slot time. One
replacement was persisted: MADE was replaced by HeeHaw at 19:57:15Z for
higher economic priority. Rotation is concentrated but not monopoly-level.

The cap is saturated with a material qualified queue, so it is a high,
plausible diversity constraint. It is not sufficient proof that increasing
the cap would create candidates: the available serviced outcomes still fail
at live-evidence maturity, not at global ranking. No persisted data attributes
cycle delay or maturity loss specifically to RPC serialization; therefore an
RPC concurrency limitation is not proven.

## Judgment

The corrected system is genuinely dynamic at the new-entry universe boundary:
six non-policy pools, rather than policy membership, supplied the observed
evaluation set. It is not yet a demonstrated multi-pool candidate-competition
system because no pool has reached ENTRY_READY in this 44.9-minute cohort.
The next investigation should distinguish whether the saturated two-lease
queue delays the required live confirmations enough to be causal, before
changing the cap, scheduler, TTL, or economics.

No source, database, policy, deployment, runtime, or trading action was
changed. New-entry authority remained disabled; no shadow or research lane was
created.
