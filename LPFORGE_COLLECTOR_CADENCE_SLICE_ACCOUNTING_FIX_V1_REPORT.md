# LPForge collector cadence / slice accounting fix V1

## Status and scope

**Status:** PARTIAL — implementation, focused tests, canonical CI, immutable
release packaging, and deployment are complete.  Live acceptance observation
began at 2026-09-01T21:48:26.761Z; the required 30-minute window has not yet
elapsed, so this report does not claim final live-acceptance completion.

This is a direct correction to the canonical discovery evidence collector.
It changes neither entry economics nor any live-confirmation rule.  New entry
authority remains disabled and no transaction was submitted.

## Root cause

The old collector calculated the collection slice from the nominal collector
interval.  With the 180-second coverage budget, cap 2, RPC concurrency 1,
and a nominal 60-second interval, this admitted two ACTIVE leases while
selecting only one pool per pass.  It also set the next collection time from
pass completion plus the nominal interval, so real work duration accumulated
additional drift.

Observed before the fix: global successful observations were roughly every
108 seconds; pool p95 gaps reached 1,141 seconds.  This was incompatible with
the existing 180-second freshness target and 450-second maximum-gap rule.

During deployment validation, a related lease-accounting defect was exposed:
a historical `ENTRY_READY` outcome could remain terminal after its ACTIVE
lease had become `QUALIFIED` and the pre-existing 15-minute cooldown expired.
That left 13 qualified pools with zero active leases.  The correction retains
the historical outcome, keeps it terminal for its producing ACTIVE lease, and
permits a cooled `QUALIFIED` row to begin a new evidence episode.

## New scheduling and safety model

- Collector slice uses active lease count, measured p95 read completion,
  RPC concurrency, and the existing 180-second revisit budget.
- At cap 2 / RPC 1, two active pools are collected in each pass when their
  measured completion time fits the revisit budget.
- The next pass delay is based on actual pass completion elapsed time; an
  overrun adds no second nominal sleep.
- Measured pass and per-pool telemetry are persisted in existing operational
  payloads: collection slice, elapsed/p95 duration, projected revisit,
  capacity violation, last service time and gap.
- A capacity violation is surfaced rather than silently admitting work that
  cannot meet the existing revisit budget.

The existing contract is unchanged: four observations, a ten-minute anchored
span, latest observation at most 180 seconds old, and gaps under 450 seconds.
Observations still persist across lease rotation and are never reset by this
change.

## Source, tests, and release

| Item | Result |
| --- | --- |
| Source before | `8f0ea62ac2ede2316dab5c34c1af056002fc855a` |
| Scheduling commit | `c91e9857ee8891c871f76835e566609186d2faed` |
| Final source | `5ea5c0d5a1b529b593d93bbec90a9a583528d56e` |
| Migration | none; M0069 remains head |
| Focused tests | 46/46 passed |
| Canonical CI | PASS |
| Artifact SHA-256 | `d4123b00e4b20595a0d509345d06d88e708e343677f2a57f16bc111a31bcf264` |
| Artifact build identity | `e4d66f02b93cd5101a0d1ba4c76203661054d16c132973d7b696db8ce8c47bdf` |
| Release integrity | PASS |

Focused coverage includes two active pools at cap 2/RPC 1, fair rotation,
completion overrun, slow RPC capacity violation, restart fairness,
non-resetting observations, four-observation/ten-minute maturity, no third
lease, and unchanged dynamic-universe/selector/entry boundaries.

## Deployment and initial observation

Only `lpforge-discovery` was reloaded.  `lpforge-production` and
`lpforge-execution` remain on the prior runtime release.  The deployed
collector is running from `/root/systems/LPForge-release-5ea5c0d` and passed
runtime identity verification.

Initial post-deployment evidence:

| Pass start UTC | Active leases | Slice | Successful pools | Elapsed | Measured p95 |
| --- | ---: | ---: | ---: | ---: | ---: |
| 21:48:26.761 | 2 | 2 | 2 | 64.848s | 57.828s |
| 21:49:31.641 | 2 | 2 | 2 | 10.745s | 6.459s |
| 21:50:31.645 | 2 | 2 | 2 | 63.546s | 56.667s |

These completed passes serviced both active pools with approximately one-minute
pass cadence.  Initial service-gap telemetry can include the pool's dormant
pre-deployment interval and is retained for audit; it is not a post-fix gap.
No post-fix starvation or unexplained post-fix 450-second gap has been
observed in this initial window.

## Safety confirmation

- ACTIVE lease cap: **2 unchanged**.
- RPC concurrency: **1 unchanged**.
- Live-confirmation contract: **unchanged**.
- Global selector, dynamic universe, discovery filters, Candidate-Primary,
  P3/P4/P7 economics, capital, OOR, settlement, and recovery: **unchanged**.
- New entry authority: **DISABLED**.
- Shadow lanes/research lanes: **none**.
- Transaction submitted by this deployment: **0**.

## Remaining acceptance work

Continue observing the deployed collector for at least 30 minutes and two
full ten-minute maturity windows.  Final acceptance must calculate service
gaps only between post-deployment successful reads of the same continuously
ACTIVE lease, then report live-confirmation confirmations, maturity throughput,
queue pressure, and whether cap 2 or RPC 1 is a remaining bottleneck.

## Post-fix 30+ minute validation (read-only update)

**Forensic cutoff:** 2026-09-01T22:45:43.184Z.  The clean cohort begins at
2026-09-01T21:48:26.761Z, immediately after the final discovery-service
deployment.  It contains 56 completed collector passes and 111 successful
ACTIVE-pool reads over 57.27 minutes.

### Lease utilization and service

Admission telemetry recorded two active leases for the complete weighted
observation period: average 2.000, median 2, p95 2, and 100.00% slot
utilization.  A qualified queue was present throughout; 100.00% of the time
was 2/2 with qualified pools waiting.  Eight distinct dynamic pools received
an ACTIVE lease during the cohort.

Collector pass duration was 29.719s mean, 16.014s median, 69.881s p95 and
73.408s maximum.  Every completed post-fix pass selected slice size 2 and
recorded two successful pool reads.

For consecutive successful reads within a continuous active-evidence episode,
the observed service gap was 60.943s median and 114.323s p95; the maximum was
439.886s, inside the existing 450-second hard limit.  The raw audit stream
also contains nine gaps above 450 seconds, all between different lease
episodes or from a dormant pre-deployment/qualified period.  They are
audit-visible but are not collector-starvation breaches: every pass serviced
both leases that it admitted.  No continuous active lease was starved.

### Maturity and Candidate-Primary outcomes

Five distinct dynamic pools produced at least one post-fix
`LIVE_CONFIRMATION_CONFIRMED` result:

| Pool | Symbol | First post-fix confirmation | Confirmation observations | Latest post-fix outcome |
| --- | --- | --- | ---: | --- |
| `3C6q…YBXt` | STONK | 21:49:01Z | 5 | WARMING after a later lease episode |
| `EAf6…5zpZ` | BUTTHOLE | 21:51:00Z | 6 | NO_TRADE |
| `Ekm4…fyWr` | OTC | 22:04:03Z | 15 | NO_TRADE |
| `fAeD…exNA` | fone | 21:51:01Z | 15 | NO_TRADE |
| `DoQb…2kka` | fone | 22:27:32Z | 15 | WARMING while its current episode obtains fresh economic evidence |

There were no post-fix `ENTRY_READY` or rejected outcomes.  Ten persisted
NO_TRADE cycles across six pools were legitimate Candidate-Primary results,
primarily `CANDIDATE_PRIMARY_NO_LOCALLY_ACTIONABLE_WINNER`, often accompanied
by `FEE_CALIBRATION_RAW_REPLAY_NOT_ACTIONABLE` and, where applicable,
`CANDIDATE_REPLAY_CONTINUITY_INSUFFICIENT`.  These are economic/evidence
outcomes after maturity, not a collector freshness failure.

The post-fix cohort has 193 WARMING cycles.  Their continued presence is no
longer evidence of missing collector cadence: a pool is WARMING whenever it
starts a new evidence episode, lacks current economic completeness, or its
previous rolling confirmation evidence has aged out.  The cadence repair
proves that pools can cross the existing confirmation contract; it does not
weaken Candidate-Primary's separate actionability gates.

### Ekm4 / OTC

`Ekm4LYkihEdQgZx2UReDMJ3eCDDjExPQLG94WfWmfyWr` reached confirmation with
15 recent observations, a 115.462-second maximum recent gap and fresh live
evidence.  Its latest actionable evaluation was P3 `NO_TRADE`, P4 `NO_TRADE`.
The exact reason remained no locally actionable Candidate-Primary winner due
to non-actionable replay/fee-calibration evidence and replay continuity.
After that terminal Phase-3 consumption, the lease was released back to
QUALIFIED; it does **not** indefinitely retain a scarce active slot.

### Queue, capacity, and selector outcomes

The queue fell from 11 qualified waiting pools at cohort start to 9 at the
latest admission snapshot, while eight distinct pools were promoted at least
once.  Rotations are prompt after a mature NO_TRADE outcome; this is why a
point-in-time registry read can show one active row between the terminal
release and the next admission reconciliation even though collector admission
snapshots are consistently 2/2.

The concurrent global-selector cohort had 114 cycles, all zero-candidate
GLOBAL_NO_TRADE cycles.  Therefore it added zero single-candidate and zero
multi-candidate selections; cumulative genuine competition remains three.

### Reassessment

The collector repair is healthy over a full 30+ minute window.  Cap 2 is now a
**partly proven** throughput limitation: both slots are continuously occupied
and a persistent queue remains, but increasing cap alone is not justified yet
because the observed mature pools produced NO_TRADE rather than ENTRY_READY.
RPC concurrency 1 is **not currently a bottleneck** for cap 2: p95 pass time
was 69.881 seconds and each active pool was serviced within the confirmation
budget.

The smallest justified next step is **A — no change; observe longer**.  The
corrected system needs a larger post-fix maturity/economics sample before any
capacity change can be tied to candidate diversity rather than merely more
non-actionable evidence.
