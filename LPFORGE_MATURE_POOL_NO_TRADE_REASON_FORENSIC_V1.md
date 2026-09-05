# LPForge mature-pool NO_TRADE reason forensic V1

## Scope and cohort

Read-only forensic.  Cohort begins with discovery runtime
`5ea5c0d5a1b529b593d93bbec90a9a583528d56e` at
2026-09-01T21:48:26.761Z; forensic cutoff is
2026-09-01T23:19:04.782Z.

The strict cohort contains **five dynamic pools** that reached
`LIVE_CONFIRMATION_CONFIRMED` and subsequently had Candidate-Primary/P3
evaluations.  It contains **13 mature-pool NO_TRADE evaluations**.  There are
no ENTRY_READY or REJECTED evaluations in this cohort.

## Mature pool results

| Pool | Symbol | First confirmed | Latest P3/P4 | Primary explanation |
| --- | --- | --- | --- | --- |
| `3C6q…YBXt` | STONK | 21:49:01Z | NO_TRADE / NO_TRADE | replay/survival evidence non-actionable |
| `EAf6…5zpZ` | BUTTHOLE | 21:51:00Z | NO_TRADE / NO_TRADE | replay/survival evidence non-actionable |
| `Ekm4…fyWr` | OTC | 22:04:03Z | NO_TRADE / NO_TRADE | replay/survival evidence non-actionable |
| `fAeD…exNA` | fone | 21:51:01Z | NO_TRADE / NO_TRADE | replay/survival evidence non-actionable |
| `DoQb…2kka` | fone | 22:27:32Z | latest episode WARMING; prior mature result NO_TRADE | replay/survival evidence non-actionable |

P4 does not independently reject a P3 winner here.  P3 returns NO_TRADE and
P4 preserves that state; Phase 5 is not reached.

## Exact canonical reasons

All 13 mature-pool NO_TRADE evaluations carried:

| Reason | Cycles | Pools | Share |
| --- | ---: | ---: | ---: |
| `CANDIDATE_PRIMARY_NO_LOCALLY_ACTIONABLE_WINNER` | 13 | 5 | 100% |
| `FEE_CALIBRATION_RAW_REPLAY_NOT_ACTIONABLE` | 13 | 5 | 100% |
| `NO_TRADE_EVIDENCE_NON_ACTIONABLE` | 13 | 5 | 100% |
| `OPERATIONAL_NO_TRADE` | 13 | 5 | 100% |
| `SHADOW_NO_TRADE` | 13 | 5 | 100% |
| `CANDIDATE_REPLAY_CONTINUITY_INSUFFICIENT` | 9 | 5 | 69.2% |

Across all 324 ranked candidate alternatives in those evaluations,
`RANGE_SURVIVAL_EVIDENCE_INSUFFICIENT`, `RANK_EVIDENCE_NON_ACTIONABLE`, and
`RANK_UNCERTAINTY_HIGH` occurred on all 324.  Replay continuity insufficiency
occurred on 198 alternatives; inventory-tail risk on 64.  Thus the local
candidate universe is not being silently discarded: every considered range is
persisted and visible as non-actionable.

## Economics versus evidence

The result is **mixed, but evidence dominated**:

- 3 of 13 mature NO_TRADE evaluations had a positive top-level expected net
  LP value.
- 2 of 13 contained at least one positive-net candidate alternative that was
  still non-actionable.
- 1 of 13 contained a positive-utility alternative, still non-actionable.
- The other alternatives had negative utility due to a combination of
  uncertainty, range-survival weakness, inventory-tail and cost penalties.

Consequently, positive economics alone does not establish ENTRY_READY; the
candidate-specific replay/survival contract is a hard actionability condition.

## Replay continuity and fee calibration

Candidate replay is not the live-confirmation stream.  For each proposed
strategy/range it needs a candidate-covered, continuous sequence of persisted
bin frames ending no later than the decision timestamp and spanning the
candidate horizon.  Missing coverage of a candidate bin, or insufficient
continuous duration, yields
`CANDIDATE_REPLAY_CONTINUITY_INSUFFICIENT` (or coverage insufficiency).
Range survival then has no valid support/sample and reports
`RANGE_SURVIVAL_EVIDENCE_INSUFFICIENT`.

Fee calibration does **not** impose a separate missing-sample threshold in
these cases.  Calibration is deliberately not applied when the raw replay is
non-actionable, producing `FEE_CALIBRATION_RAW_REPLAY_NOT_ACTIONABLE`.
Therefore fee calibration is a downstream diagnostic, not the primary failed
pipeline.  The shared post-maturity bottleneck is candidate-specific replay /
range-survival actionability.

This can improve only when sufficient continuous candidate-covered bin-frame
evidence is collected.  It is not proven structurally unavailable, but the
current five-pool sample has not produced it.  Status: **slow/progressing,
not a proven broken source**.

## OTC deep dive

Latest OTC NO_TRADE at 2026-09-01T23:12:04.219Z:

- expected fee value: `+0.00009918462883633708 SOL`
- expected inventory PnL: `-0.000026925457215269423 SOL`
- expected net LP value: `+0.00003675917162106766 SOL`
- forecast uncertainty: `0.7137642095592514`
- Candidate-Primary/P3/P4: NO_TRADE / NO_TRADE
- candidate replay/fee calibration: non-actionable / raw calibration not
  applied

The persisted ranking has no actionable positive-utility candidate.  OTC
would be ENTRY_READY if replay/fee evidence were actionable: **NOT_PROVABLE**;
the positive aggregate economics do not prove any concrete range would pass
its survival, uncertainty, and inventory-risk checks.

## Health and conclusion

Candidate-Primary ran for all 13 mature evaluations; no Candidate-Primary
error, timeout, or missing-result row was found.  This is not a P4 or global
selector failure.

Classification:

- Primary root cause: **COMMON_EVIDENCE_MATURITY_DELAY** — candidate-specific
  replay/range-survival actionability.
- Secondary: **MIXED economics/risk** — many alternatives also have
  non-positive utility, high uncertainty, or inventory-tail penalties.
- Post-maturity implementation gap: **not proven**.  The collector now
  supplies live confirmation successfully; the remaining evidence contract is
  separate and is being enforced consistently.

One blocker from ENTRY_READY: **1 evaluation** (positive utility but only
non-actionable replay/survival evidence).  Two or more blockers: **12**.

## No-change confirmation

No source, DB, deployment, policy, selector, Candidate-Primary, collector,
threshold, or entry-authority change was made.  Entry authority remains
disabled and no transaction was submitted.
