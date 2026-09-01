# LPForge repeated same-pool entry forensic

Forensic cutoff: 2026-08-31T21:09:24.611Z. This report is read-only. No position, database row, service, policy, configuration, or deployment was changed.

## Executive finding

LPForge opened four positions on 2026-08-31, not approximately three. All used EsR3gRxMtqt3bBhDDsuY3SFyYNYvYzszzG9KVYpcQfs7, the NEEGY / WSOL pool. Each used a new, fresh P3/P4 decision and a newly constructed within-pool thesis; none reused stale evidence.

Candidate-Primary did not compare EsR3 candidate strategies/ranges against candidate sets from other pools. It received one pool at a time. In every entry cycle the persisted P7 control record scheduled exactly one decision probe, and its target was EsR3. The evidence therefore does not establish that EsR3 was globally best. It establishes only that EsR3 was the sole fresh ENTRY_READY pool in the persisted decision set at each entry instant.

Classification: POLICY_GAP, not a Candidate-Primary arithmetic bug. The smallest issue to address before changing policy is the absence of a persisted, simultaneous cross-pool opportunity set at the execution decision boundary. Without it, global economic comparison cannot be made or audited.

## Current open position

| Field | Value |
|---|---|
| Position | BcHk2btyymBVz8W5Yk2pMhCpz23ZvAV8k2MzvUgqL2J1 |
| Pool | EsR3gRxMtqt3bBhDDsuY3SFyYNYvYzszzG9KVYpcQfs7 |
| Strategy / shape | BID_ASK / BALANCED |
| Range / entry bin | -597..-583 / -589 |
| Entry time | 2026-08-31T20:22:26.718Z |
| Capital | 30,000,000 lamports (0.03 SOL) |
| Lifecycle | OPEN; reconciliation MATCH |
| Latest chain-backed range observation | IN_RANGE, active bin -596, at 2026-08-31T21:09:09.504Z |
| OOR | Zero excursions; continuous OOR 0 seconds |
| OOR recommendation | HOLD (POSITION_IN_RANGE) |
| Latest position-attributable fee valuation | 383,336 lamports; claimable-value estimate, not realized PnL |

No durable M0066 management-metric row existed for this new lifecycle at the cutoff. Current NAV, mark-to-market return, and token/SOL split are therefore not stated without inventing values.

P7 was PRODUCTION / HEALTHY / WATCH / NORMAL / OBSERVE_ONLY with newEconomicActionAllowed=false at cutoff, due to existing position-limit and drift-watch reasons. Production and execution were online. There was one open lifecycle, no execution plan in active/recovery/unknown state, three DEPLOYED reservation records, and zero unknown submissions.

## Today's entry timeline

All times UTC. Values are frozen entry-time facts.

| # | Position | Entry time | Strategy / range / entry bin | P3 utility | Candidate net value (SOL) | P4 readiness / confidence | Evidence age | Regime | Outcome / gap |
|---:|---|---|---|---:|---:|---:|---:|---|---|
| 1 | DrbJX...MK7w | 06:22:52.730 | BID_ASK / SKEWED_Y; -583..-573; -576 | 0.0000338302 | +0.0000996757 | 0.731913 / 0.126078 | 161.404 s | SIDEWAYS | settled -406,220 lamports |
| 2 | BhhRQ...gpEx | 08:18:32.454 | CURVE / ONE_SIDED_Y; -589..-579; -579 | 0.0000601917 | +0.0001238044 | 0.815460 / 0.169718 | 202.810 s | CONSOLIDATION | settled +320,468 lamports |
| 3 | HVEbGM...NZtp | 13:04:46.144 | BID_ASK / SKEWED_Y; -578..-568; -571 | 0.0000423873 | +0.0000625451 | 0.625461 / 0.104953 | 270.431 s | TRANSITION | settled -1,925,242 lamports; 25m 11s after Bhh |
| 4 | BcHk2...L2J1 | 20:22:26.718 | BID_ASK / BALANCED; -597..-583; -589 | 0.00000802865 | +0.0000367766 | 0.773528 / 0.061658 | 133.672 s | TRANSITION | open; 1h 15m 34s after HVE |

Each decision expired five minutes after observation. Ranges, entry bins, strategies, regimes, utilities, and recommendation IDs changed between entries. Classification: NEW_INDEPENDENT_THESIS for all four. This concerns freshness, not global optimality.

The first two lifecycle intervals overlap in persisted data from 08:18:32.454 to 12:35:53.666, about 4h 17m. A simple close-then-reopen slot-recycle model cannot explain all four entries. The P7 portfolio snapshot immediately before Bhh reported openPositions=0 while Drb lifecycle was still OPEN for the same owner. That is a separate historical portfolio-state consistency issue; this forensic does not alter it.

## Exact selection architecture

Discovery and static execution-policy pools feed productionEvaluationPoolAddresses. It returns static policy pools, owned pools, and bounded dynamic Tier-A pools. phase7BoundedDecisionHealthProbePoolAddresses then chooses exactly one deterministic pool per P7 cycle. runAutonomousDecisionProbe calls evaluateOperationalCycle with that singular pool, then Candidate-Primary ranks strategies/ranges for that one pool before P3, P4, P7, and execution.

Authoritative source boundaries:

- packages/phase7-production-service/src/index.ts, productionEvaluationPoolAddresses (line 229): static-policy, owned, and bounded dynamic Tier-A pools.
- The same file, phase7BoundedDecisionHealthProbePoolAddresses (lines 74-80): one deterministic target per P7 cycle.
- The same file, runPhase7ProductionOnce (lines 299-302): runs the decision probe.
- packages/operational-runtime/src/index.ts, evaluateOperationalCycle: singular input.pool.
- packages/candidate-ranking/src/index.ts: ranks candidates constructed for that one pool.

Candidate-Primary cross-pool ranking: NO.

## Why EsR3 got repeated opportunities

Immediately before all four entries P7 recorded:

decisionHealthProbePoolAddresses = [ EsR3gRx...Qfs7 ]
newEconomicActionAllowed = true
daemonPlan = DECISION_CYCLE

The operator evaluated EsR3 alone. At each exact entry instant, the database contained one unexpired P3 ENTRY_READY and one unexpired P4 ENTRY_READY authorization: EsR3. There was no persisted fresh, entry-authorized competitor at the same instant.

This does not make it a global winner. Other pools had not reached the same fresh authorization state in the serialized schedule. The static policy contains five pools, including EsR3, but P7 probes one target per cycle.

## Discovery coverage and collector effects

The active-evidence collector policy defaults to 30 collectors, but serviceable capacity was two. At the four entry times:

| Entry | Active collector pools | Waiting qualified pools | EsR3 active-collector member? |
|---|---:|---:|---|
| Drb | 2 | 7 | No |
| Bhh | 0 | 6 | No |
| HVE | 1 | 6 | No |
| BcH | 1 | 5 | No |

The collector authority was DISCOVERY_OBSERVATION_ONLY; it was not EsR3's repeated selection route. Nearby discovery cycles had 33-36 pools including higher-priority and higher-fee-percentile pools, but those rows are not same-time P3/P4 economic candidates.

EsR3 remained a static execution-policy pool despite its latest discovery-registry state being REJECTED, with TVL and 24h-volume below the discovery minimum. Static policy inclusion is thus independent of the discovery collector.

## Competition and opportunity cost

| Entry | Fresh P3 ENTRY_READY pools | Fresh P4 ENTRY_READY pools | Repeated pool globally best? |
|---|---:|---:|---|
| Drb | 1: EsR3 | 1: EsR3 | NOT GLOBALLY COMPARED |
| Bhh | 1: EsR3 | 1: EsR3 | NOT GLOBALLY COMPARED |
| HVE | 1: EsR3 | 1: EsR3 | NOT GLOBALLY COMPARED |
| BcH | 1: EsR3 | 1: EsR3 | NOT GLOBALLY COMPARED |

OTHER_POOL_BETTER_BUT_NOT_COMPARED is UNKNOWN, not proven: there is no same-time multi-pool P3/P4 candidate set. Other pools existed upstream but comparable economics were not assembled at execution.

## Re-entry memory and realized-outcome feedback

The repository has a discovery-state COOLDOWN type and market.pool_discovery_registry.cooldown_until, but no production operational or candidate-ranking consumer implements post-settlement pool cooldown, same-day entry limit, consecutive-pool exposure limit, cumulative-pool-PnL penalty, or pool-level re-entry delay.

Realized lifecycle performance is persisted in research.live_learning_outcomes and consumed by apps/discovery-learning with RESEARCH_ONLY_NO_POLICY_MUTATION. No operational-runtime, Candidate-Primary, P3, P4, or P7 selection code consumes it.

HVE settlement v2, -1,925,242 lamports, was available at 19:06:52.977 before BcH decision at 20:22:13.080. It did not affect BcH pool score, utility, risk, strategy, admission, or selection.

PREVIOUS REALIZED POOL PERFORMANCE IS NOT A PRODUCTION SELECTION INPUT.

## Same-pool history, descriptive only

| Position | Strategy | Latest authoritative net | Return from 30m | Status |
|---|---|---:|---:|---|
| 8G992...bjsQ | CURVE / ONE_SIDED_Y | -32,525 | -0.1084% | SOL_SETTLED v3 |
| F3V7UH...ue1k | SPOT / ONE_SIDED_Y | -115,822 | -0.3861% | SOL_SETTLED v2 |
| DrbJX...MK7w | BID_ASK / SKEWED_Y | -406,220 | -1.3541% | SOL_SETTLED v2 |
| BhhRQ...gpEx | CURVE / ONE_SIDED_Y | +320,468 | +1.0682% | SOL_SETTLED v2 |
| HVEbGM...NZtp | BID_ASK / SKEWED_Y | -1,925,242 | -6.4175% | SOL_SETTLED v2 |
| BcHk2...L2J1 | BID_ASK / BALANCED | — | — | OPEN |

Settled aggregate: five entries, one win, four losses, cumulative -2,159,341 lamports, mean -431,868, median -115,822, and position-attributable fee cashflows 1,343,421 lamports. Comparable inventory-PnL decomposition is incomplete for pre-M0065 history and is not fabricated.

## Classification and no-change statement

Classification: POLICY_GAP. Components: B, E, F, I, K (MIXED).

- B: no global cross-pool ranking — proven.
- E: no production post-settlement pool cooldown — proven.
- F: no realized-outcome feedback — proven.
- I: slot recycle contributed to HVE to BcH, but cannot explain Drb/Bhh overlap.
- K: static-policy inclusion, serialized P7 scheduling, no outcome feedback, and no re-entry memory combine to create repeated opportunities.

Not proven: Candidate-Primary arithmetic defect, collector-cap bias selecting EsR3, monitoring stickiness, stale-evidence reuse, or an objectively better pool ignored by a global comparator.

No code changed, no trading policy changed, no database row changed, no service was restarted, no deployment occurred, and the current live position was not altered.

