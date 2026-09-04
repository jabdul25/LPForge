# LPForge retained-tracker deadline headroom fix V1

STATUS: FIXED

## Incident reconstruction

Pool: `54sbyULrreD9HBoV5wRWedeCBEw6gQ7VkdHW18rLX78e`.

- Previous successful retained observation: 2026-09-04T21:58:57.543Z
- Logical evidence deadline: 2026-09-04T22:06:27.543Z (`+450s`)
- Next successful observation: 2026-09-04T22:07:10.993Z
- Actual gap: 493.450s; overrun: 43.450s

The authoritative collector-capacity records show that after 21:59:05 the pool was in the waiting cohort, not in the continuity cohort. Ordinary economic slices ran at 22:00:37, 22:01:48, 22:02:48, 22:03:48, 22:04:52 and 22:06:04; 54sby was not selected. Its next selection started at 22:07:04. There was no provider outage or retained-read failure in this interval.

Root cause: `NON_CONTINUITY_WORK_PREEMPTED_DEADLINE` combined with `ZERO_HEADROOM_DEADLINE_POLICY`. The old collector appended qualified continuity candidates after the ordinary economic slice and ranked only by the hard deadline. Once 54sby was no longer in the active economic slice, it had no deadline-aware service priority and ordinary work consumed the remaining window.

## Repair

Implementation ID: `retained-continuity-deadline-headroom-v1`.

- Logical deadline remains `lastObservationAt + 450s`.
- Internal service deadline is `lastObservationAt + 300s`.
- Safety margin is 150s: the observed 60s collector cadence plus approximately 90s p95 pool-read duration.
- The deadline is computed from the latest successful retained observation, not stale payload metadata.
- Earliest internal deadline is the primary tracker comparator; maturity is retained as a tie-breaker.
- Retained continuity candidates are collected before ordinary fair-slice work. Backfill preparation is limited to ordinary work so it cannot delay a protected read.
- Successful retained reads persist `lastObservationAt`, logical deadline, and internal service deadline. Waiting/completed cleanup clears the new active field.

No evidence threshold, tracker cap, economic cap, RPC concurrency, range, P3/P4, P6, execution, or settlement behavior changed.

## Verification

- Focused scheduler tests: 42/42 PASS.
- Canonical CI: 986/986 PASS.
- Boundary and migration checks: PASS.
- Exact 54sby timestamp regression proves logical deadline `22:06:27.543Z` and internal deadline `22:03:57.543Z` from the historical final success at `21:58:57.543Z`.
- Regression proves a qualified retained candidate is collected before ordinary fair-slice work and earlier internal deadlines win over rank/utility.

Source before: `65720b7819b114d0119216a6e6180962cddc583b`.
Source after / deployed discovery runtime: `7e31dbdf2749043b4c39e661e802cd4642808ace`.

At deployment completion there were no active retained trackers, so fresh live-gap validation begins with the next natural continuity admission. Production was left running.
