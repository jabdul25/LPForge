# LPForge continuity eviction priority fix V1

## Scope and decision

This change corrects continuity-tracker capacity selection only.  It leaves the
economic lease cap at 2, continuity cap at 2, read RPC concurrency at 1, the
four-observation / anchored ten-minute confirmation contract, and all P3/P4,
economic, risk, selector, capital, and position policy unchanged.

The prior contract in `Phase1Store.reconcileEvidenceContinuityTracking` sorted
eligible `TRACKING` records only by `evidenceContinuityTrackingStartedAt` and
pool address.  Consequently a newly-contested two-slot pool set could evict a
near-complete confirmation episode merely because it started later.

The replacement is `continuity-maturity-aware-eviction-v1`.  It derives its
decision from canonical current evidence and sorts deterministically by:

1. remaining time to a valid anchored confirmation episode;
2. anchor presence, valid observation count, and valid observation span;
3. current Tier-A rank, candidate utility, and readiness; and
4. tracker age then pool address.

Only records that are already eligible for bounded continuity tracking are
compared.  It does not grant execution authority or make a current Tier-B pool
eligible for execution.

## Regression and cohort evidence

The 90-minute evidence cohort contained 12 Tier-A pools.  Three reached the
anchored ten-minute confirmation window.  Two otherwise progressing episodes
were capacity-evicted before maturity:

| Pool | observations | span at eviction | remaining to ten minutes | finding |
| --- | ---: | ---: | ---: | --- |
| BUTTHOLE (`EAf6…5zpZ`) | 4 | 285 s | about 315 s | rank-1 Tier-A, evicted by FIFO |
| fAeDy (`fAeDy…exNA`) | 3 | 145 s | about 455 s | evicted while progressing |

The deterministic BUTTHOLE regression replays the exact material condition: a
four-observation, 285-second anchored episode outranks an immature newcomer
and is retained.  It can reach ten minutes within the existing cap-2 projected
continuity revisit budget.  The historical database does not retain a complete
point-in-time contender snapshot for the fAeDy eviction, so its counterfactual
retention and confirmation are *plausible but not asserted as proven*.  No
profitability or P4 result is inferred from either confirmation result.

With two economic leases and two continuity records, the existing measured
scheduler model projects a 360-second continuity revisit.  A third continuity
record projects 450 seconds—consuming the whole maximum-gap budget with no
headroom—and is intentionally not enabled.  This priority change does not add
a collection slot or RPC request.

## Validation

- Focused evidence-pipeline tests: 39/39 passed.
- Canonical CI: 891/891 passed.
- New tests cover near-mature protection, anchor/count/span ordering,
  rank/utility tie breaking, deterministic ties, cap=2, unchanged RPC=1, and
  the cap-3 no-headroom calculation.
- The immutable discovery release was verified against source
  `caf2c27db41d8a1cae63d1b8445a3b6378ebda8f` and is online.  Its initial live
  collector passes continued to write new WARMING evaluations after restart.

The release archive deliberately excludes `node_modules`.  The first launch
therefore failed before discovery startup because the manual release assembly
omitted the canonical read-only shared dependency symlink.  The process was
immediately restored, then relaunched from the same immutable release with the
canonical `/root/systems/LPForge/node_modules` link.  No execution service,
policy, signer, position, or entry authority was changed.

## Live operation

At deployment, P7 remained Production/Healthy/Watch/Normal; unattended entry,
dispatch, live signing, and the mainnet gate remained enabled.  Active
positions, UNKNOWN submissions, reconciliation debt, and terminalization debt
were zero.

The change is deployed for the next real capacity contest.  Confirmation yield
must be measured from that live event; it is not safe to claim that a simulated
episode became an actual entry.  A real post-deploy Tier-A near-maturity
tracker should now remain preferred over an immature contender, then release
normally on confirmation, terminal state, staleness, or TTL expiry.
