# LPForge P4-ready to live-position conversion forensic V1

**Window:** 2026-09-04 06:26:28 UTC through 2026-09-05 03:47:33 UTC.  
**Status:** CONFIRMED_DEFECT.

## Result

The P4/global/winner-preparation boundary is healthy for this cohort. All ten P4
`ENTRY_READY` records were evaluated, all ten were selected as `GLOBAL_WINNER`,
and each had 0.03 SOL allocated with `operationalEntryReady=true` at selection.

The conversion loss is downstream: one OPEN plan for 54sby was claimed,
signed/submitted, then durably entered `RECONCILIATION_REQUIRED` with unknown
chain effect. The execution daemon deliberately runs recovery before claiming
new plans and, while that hold exists, does not call `claimNextAutonomousPlan`.
Consequently two later fresh plans expired in `PLANNED` without a P6 claim, and
later winners did not receive an executable-preparation plan. This is not a
selector, actionability, candidate-identity, or plan-provenance failure.

The safety hold is correct for an unknown submission effect. It does expose a
separate operational accounting defect: P7 was reporting a clean portfolio while
the execution journal still contained this unresolved plan. This forensic did not
alter P7 or P6 because resolving unknown chain effect requires authoritative chain
reconciliation, not a safe local state mutation.

## Cohort outcome

| P4 time | Pool | Global result | Preparation / plan result | Classification |
|---|---|---|---|---|
| Sep 4 09:29:13 | ErwEe | GLOBAL_WINNER | Dispatch allowed; `plan-b6df…83cc`; claimed, risk-permitted and sent; expired without chain effect | legitimate P6 expiry/no effect |
| Sep 4 09:48:17 | ErwEe | GLOBAL_WINNER | Dispatch allowed; `plan-fa11…c11a`; claimed, permitted and submitted; reconciled | live OPEN control, later settled |
| Sep 4 09:48:52 | ErwEe | GLOBAL_WINNER | No preparation plan: `P7_PLAN_OPEN_POSITION_LIMIT` | legitimate position-cap containment |
| Sep 4 09:56:09 | 6xBK | GLOBAL_WINNER | No preparation plan: `P7_PLAN_OPEN_POSITION_LIMIT` | legitimate position-cap containment |
| Sep 4 13:30:32 | 54sby | GLOBAL_WINNER | Dispatch allowed; `plan-ef194…63fd`; claimed, permitted, submission sent | unresolved P6 chain-effect hold |
| Sep 4 14:13:35 | Ekm4 | GLOBAL_WINNER | Dispatch allowed; `plan-e27c…b6f`; never claimed; expired while recovery hold was active | recovery gate blocked pickup |
| Sep 4 14:14:13 | Ekm4 | GLOBAL_WINNER | No additional plan while prior/equivalent execution work was pending | legitimate duplicate/pending-work suppression |
| Sep 4 20:14:37 | 7t477 | GLOBAL_WINNER | Dispatch allowed; `plan-c811…fad3`; never claimed; expired while recovery hold was active | recovery gate blocked pickup |
| Sep 4 20:34:18 | 7t477 | GLOBAL_WINNER | No additional plan while pending same-pool work existed | legitimate duplicate/pending-work suppression |
| Sep 5 00:09:04 | 7t477 | GLOBAL_WINNER | No preparation plan; unresolved recovery hold remained active | recovery gate containment |

There were no candidates lost to a better winner, stale before selection,
excluded from ranking, or rejected by global actionability.

## Funnel

| Stage | Count | Conversion from preceding stage |
|---|---:|---:|
| P4 ENTRY_READY | 10 | — |
| Globally evaluated | 10 | 100% |
| GLOBAL_WINNER | 10 | 100% |
| Executable preparation / dispatch allowed | 5 | 50% |
| Fresh plans persisted | 5 | 100% |
| P6 claims | 3 | 60% |
| P6 permits / successful pre-submit path | 3 | 100% of claims |
| Submissions | 3 | 100% of permitted plans |
| Position opens | 1 | 33.3% of submissions; 10% of P4-ready |

The only completed opening control is `plan-fa11a94c1955baf48a451b66b7c2c11a`
for ErwEe/DOGE-1. It is now `RECONCILED` (the position later reached terminal
settlement); it proves the historical P4-ready → plan → P6 → live position path.

## Exact blocking evidence

`plan-ef19412a3d9620ad105dfc6b600163fd` (54sby) was claimed at
2026-09-04 13:30:51 UTC. It has one sent JUPITER submission:
`2i3tc6qudjahBM7waKEor9WBYkdsFNu4RkCMjPg37EWYSXoStXE5ciabZix4AcsarNzK9Q6MxEtKLe9syGfoUy7s`.
At 13:31:36 UTC recovery persisted:

```
P6_RECOVERY_HOLD_FOR_OPERATOR
economicEffect=UNKNOWN
confirmationStatus=UNKNOWN
positionTruth.available=false
```

This plan remains `RECONCILIATION_REQUIRED`. The execution main loop executes
`recoverOnce()` before `dispatchOne()` and returns `RECOVERY_PENDING` whenever
an unresolved recovery result exists. Thus it intentionally did not claim
`plan-e27c…` or `plan-c811…`; both were left `PLANNED` until their five-minute
market-validity windows expired.

## Contract checks

- Global selector: healthy; all ten P4-ready candidates were winners with matching candidate/pool identity and no selector reasons.
- Winner preparation: healthy where admissible; the first collection pass is intentionally dispatch-disabled, while the identity-bound preparation pass created a fresh plan for five winners.
- Plan persistence and HMAC/provenance: healthy for each five fresh plans.
- Runner pickup: working for plans before recovery containment; deliberately paused by the unresolved 54sby recovery hold afterwards.
- P6/simulation/signing/submission: no new regression shown. The 54sby plan reached a real submission then correctly failed closed on unknown effect.
- No stale-plan reuse, cross-cycle identity mismatch, or circular dependency was found.

## Recommendation

Do not bypass recovery or resubmit the 54sby plan. Reconcile the recorded
signature and position truth through the canonical recovery path, then ensure the
P7 portfolio/debt view includes unresolved execution-journal recovery holds. Once
that state is terminalized from authoritative chain evidence, the execution daemon
will resume claiming only fresh, unexpired plans.

No production code, config, policy, process, or plan state was changed by this
forensic.

