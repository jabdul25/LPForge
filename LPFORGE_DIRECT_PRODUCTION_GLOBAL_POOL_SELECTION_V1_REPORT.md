# LPForge direct Production global pool selection v1

## Executive conclusion

The prior single deterministic pool probe was a policy gap: it supplied one pool to
Candidate-Primary, so Candidate-Primary only compared strategy/range variants inside
that pool.  `global-pool-selection-v1` replaces that entry-selection authority with
one canonical Production decision cycle: evaluate each serviceable eligible pool,
retain its best Candidate-Primary result, compare the per-pool winners by comparable
absolute economics, then hand only the selected winner to the unchanged downstream
P4/P7/execution path.  There is no newly introduced shadow lane, research lane,
parallel selector worker, or shadow table.

The release is deployed with **new entry dispatch disabled** for validation.  It is
not yet safe to enable entries: the live validation cycles evaluated five eligible
pools but only one had a fresh, complete candidate record, so the selector correctly
returned `GLOBAL_NO_TRADE / GLOBAL_COVERAGE_INCOMPLETE`.  It did not fall back to the
former deterministic probe path.

## Rollback cleanliness and scope

Before this implementation, the stopped shadow-oriented draft was removed.  The
current source contains no `GLOBAL_POOL_SELECTION_SHADOW`,
`GLOBAL_POOL_SELECTION_AUTHORITATIVE`, `global_selection_shadow_results`, shadow
selector service, or new research/shadow schema.  Existing historical
`research.shadow_recommendations` remains a legacy Candidate-Primary persistence
source; this release neither changes it nor creates a new lane from it.

Unrelated pre-existing untracked forensic reports and release tarballs were
preserved.  Candidate-Primary scoring, P3, P4, P7 protection, OOR, management,
execution construction, accounting, capital, and the one-position cap were not
changed.

## Architecture

Old entry authority:

```
eligible pools -> deterministic P7 probe -> evaluateOperationalCycle(pool)
  -> Candidate-Primary inside that pool -> P3/P4 -> entry
```

Current entry authority:

```
Production eligible-pool snapshot
  -> fair bounded per-pool evaluation at one decision cutoff
  -> Candidate-Primary: best candidate per pool
  -> comparable global ranking + bounded pool-history context
  -> GLOBAL_WINNER or GLOBAL_NO_TRADE
  -> unchanged P4/P7/execution for the one selected candidate
```

The canonical orchestration is `runProductionGlobalSelectionCycle` in
`packages/phase7-production-service/src/index.ts`.  It calls existing per-pool
evaluation with plan dispatch suppressed, records `execution.production_global_selection_cycles`
and `execution.production_global_pool_candidates`, then prepares only the global
winner when entry authority is enabled.  `apps/operator/src/main.ts` verifies the
selected candidate identity before plan persistence.  The retained deterministic
P7 probe is health-observation plumbing only; it no longer authorizes an entry.

`packages/candidate-ranking/src/index.ts` is unchanged: Candidate-Primary remains
the per-pool strategy/range optimizer.  P4 remains downstream: a P4 state does not
exclude a pool from the upstream per-pool candidate comparison.

## Global cycle, comparability, and fairness

Each cycle persists a cycle id, cutoff, eligible/evaluated/candidate counts,
coverage state, global outcome, ranks, reasons, source release and build evidence.
Pool order is a deterministic rotated ordering keyed by the cycle, avoiding a
permanent alphabetical/insertion-order bias.  Evaluation concurrency is bounded at
two and the global cycle has a 120-second deadline.  Incomplete coverage fails
closed; it never reverts to the old one-pool entry path.

The base metric is canonical `riskAdjustedExpectedNetEv`.  Comparison is allowed
only when all candidate records have equal capital and horizon; current candidates
are 0.03 SOL / 60 minutes.  Candidate evidence must be fresh against the same frozen
cutoff (maximum age 300 seconds).  Missing, stale, or incomparable facts give
`GLOBAL_NO_TRADE`.

## Bounded same-pool context

`pool-reentry-context-v1` derives pool-scoped, live-realized history from the latest
immutable settlement version for each lifecycle.  It records last settlement/outcome
and close provenance, UTC-day entries/wins/losses, cumulative realized net,
inventory PnL, fees, token-risk/below-range close counts, and source lifecycle ids.
No pool is permanently banned and no guessed penalty coefficient was introduced.

The hard safety invariant is narrow: a post-settlement re-entry to the same pool
requires decision evidence strictly newer than that pool's last settlement.  This is
not a timer cooldown.  History is pool-address keyed, not token keyed, and is
available before global ranking as explainability and deterministic tie-breaking
context.  The latest corrected immutable settlement results are consumed, including
HVE `-1,925,242`, Bhh `+320,468`, Drb `-406,220`, and 8G992 `-32,525` lamports.

## Historical replay

The 2026-08-31 entries Drb, Bhh, HVE and BcH cannot be used to fabricate a global
counterfactual.  Their frozen record coverage provides the EsR3 per-pool result but
not a contemporaneous complete comparable candidate set for other pools.  Each is
therefore classified `REPLAY_COVERAGE_INCOMPLETE`; no future data was used.

## Tests and release evidence

Focused selector, pool-history, scheduler, P3/P4, P7, execution and accounting
regression coverage passed.  Full canonical CI passed **923 / 923** tests.  The
forward-only schema migration is `M0068_production_global_pool_selection.sql`.

Release identity:

| Item | Value |
|---|---|
| Source commit | `1f5061f1c0b37420269920385e4f77a151f51dee` |
| Build identity | `f2e8e6b740501647f4b903976261f96a8b100e091a0991182a9015804f6fa99c` |
| Migration head | `M0068_production_global_pool_selection.sql` |
| Release integrity | PASS |
| Runtime service | `lpforge-production` online from `/root/systems/LPForge-release-1f5061f1c0b3` |

## Live validation with entry dispatch disabled

The deployed canonical selector is running with:

```
LPFORGE_GLOBAL_POOL_SELECTION_ENTRY_DISABLED=true
LPFORGE_P7_PLAN_DISPATCH_ENABLED=false
LPFORGE_GLOBAL_POOL_SELECTION_CONCURRENCY=2
```

Protective position management remains enabled.  At the forensic cutoff it had
recorded 27 canonical validation cycles: five had one fresh valid candidate and 22
had none; none had two or more fresh comparable candidates.  A recorded one-candidate
cycle evaluated five eligible pools and recorded:

```
eligible=5, evaluated=5, candidates=1
outcome=GLOBAL_NO_TRADE
reason=GLOBAL_COVERAGE_INCOMPLETE
winner=none
```

The single valid candidate was EsR3.  The newest cycle evaluated five pools and had
zero valid candidates, with `GLOBAL_COVERAGE_INCOMPLETE` and
`GLOBAL_NO_VALID_POOL_CANDIDATE`.  This proves that the system records actual
competitor coverage and refuses to claim that EsR3 won globally when other pools do
not produce fresh comparable candidates.  No entry transaction was prepared or
submitted by this validation release.

The existing position `BcHk2btyymBVz8W5Yk2pMhCpz23ZvAV8k2MzvUgqL2J1` remains OPEN
in EsR3 with exactly 30,000,000 lamports initial capital.  It was not modified.

## Promotion gate

Do not enable new entries yet.  Required missing evidence is at least one, and
preferably a small stable cohort of, `COMPLETE` multi-pool cycles with two or more
fresh comparable valid candidates; bounded latency, fair rotation and deterministic
ranking must remain intact; and the candidate identity lock must continue to match
the downstream preparation result.  Until then, entry authority remains disabled;
the system fails closed rather than using the former single-pool authority.

## No-change statement

No permanent parallel selector or research lane was created.  No cooldown, hard
pool ban, arbitrary loss penalty, fee policy, risk threshold, capital allocation,
position management, OOR behavior, transaction construction, or accounting policy
was changed.
