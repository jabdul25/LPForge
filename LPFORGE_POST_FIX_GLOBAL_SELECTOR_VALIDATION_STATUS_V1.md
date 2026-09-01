# LPFORGE — Post-Fix Global Selector Validation Status V1

## Scope

Read-only validation snapshot. No source, database, deployment, runtime configuration, policy, selector, discovery, or execution change was made. New-entry authority remained disabled and no transaction was submitted.

Forensic cutoff: `2026-09-01T18:18:43.950542Z`.

## Runtime health

| Item | Observed state |
| --- | --- |
| Source/runtime release | `23d6f9f22a7c5273f4c66fbee287c483903ea6c4` |
| Migration head | `M0069_production_global_candidate_contract.sql` |
| P7 | `OBSERVE_ONLY`, `HEALTHY`, `PRODUCTION`; `P7_DAEMON_DECISION_CYCLE_READY` |
| New economic action allowed | `false` |
| Execution service | online |
| Active positions | 0 |
| Pending operational recovery plans | 0 |
| Active UNKNOWN submissions | 0 |
| Blocking reconciliation debt | 0 |
| Terminalization debt | 0 |
| Superseded reconciliation history | 1 audit-visible, non-blocking row |

The BcH historical parent-plan UNKNOWN did not recur as blocking debt: P7 entered `RECOVER_ONLY` zero times in the post-fix cohort.

## Exact post-fix cohort

Primary cohort start: `2026-09-01T18:03:16.274Z`.

| Metric | Value |
| --- | ---: |
| Cohort duration at cutoff | 15m 28s |
| Persisted global cycles | 27 |
| First cycle | `2026-09-01T18:03:16.274Z` |
| Latest cycle | `2026-09-01T18:18:17.921Z` |
| Mean cycle-write gap | 34.679s |
| Median cycle-write gap | 32.078s |
| p95 cycle-write gap | 40.672s |
| Largest cycle-write gap | 94.560s |

The largest gap was explained by one persisted, complete seven-pool evaluation lasting 91.688s (`18:16:46.233Z` to `18:18:17.921Z`), below the 120-second deadline. It was not a lost P7 cycle and not reconciliation recovery.

## Cycle partition

| Partition | Count | Share |
| --- | ---: | ---: |
| Zero valid candidates | 27 | 100.00% |
| One valid candidate | 0 | 0.00% |
| Two or more valid candidates | 0 | 0.00% |
| `GLOBAL_NO_TRADE` | 27 | 100.00% |
| `GLOBAL_COVERAGE_INCOMPLETE` | 1 | 3.70% |
| Sole-candidate selected | 0 | 0.00% |
| Competitive global winner | 0 | 0.00% |

No post-fix pool produced an `ENTRY_READY` global candidate. Therefore there is no post-fix candidate-pool ranking, no sole-candidate owner, and no post-fix winner/runner-up comparison to validate.

## Evaluated-pool outcome quality

The normalized production contract persisted the non-candidate states rather than dropping them:

| State | Records |
| --- | ---: |
| `WARMING` | 179 |
| `NO_TRADE` | 3 |
| `REJECTED` | 2 |
| `ENTRY_READY` | 0 |

All 27 cycles contained WARMING evidence. Three cycles also had a locally non-actionable Candidate-Primary outcome; two contained a rejection. Dominant reason codes were `GLOBAL_POOL_WARMING`, `OPERATIONAL_EVIDENCE_MATURITY_PENDING`, `ENTRY_LIVE_CONFIRMATION_PENDING`, and `OPERATIONAL_ECONOMIC_EVIDENCE_MISSING`. The three `NO_TRADE` outcomes were explicitly preserved as `CANDIDATE_PRIMARY_NO_LOCALLY_ACTIONABLE_WINNER`, rather than being silently treated as stale or absent.

## EsR3 and BcH re-entry context

`EsR3gRxMtqt3bBhDDsuY3SFyYNYvYzszzG9KVYpcQfs7` was evaluated in all 27 cycles and was `WARMING` in all 27.

| EsR3 post-fix metric | Value |
| --- | ---: |
| Valid candidates | 0 |
| Sole-candidate cycles | 0 |
| Multi-candidate participation | 0 |
| Competitive wins / losses | 0 / 0 |

BcH is correctly consumed by the bounded `pool-reentry-context-v1` context for EsR3. The first post-fix EsR3 record and subsequent records contain:

- source lifecycle: `lifecycle:BcHk2btyymBVz8W5Yk2pMhCpz23ZvAV8k2MzvUgqL2J1`
- latest settlement timestamp: `2026-09-01T08:31:44Z`
- latest realized net: `-1,853,187` lamports
- latest return: `-0.0617729`
- last OOR direction: `BELOW_MIN`
- inventory classification: `MIXED_INVENTORY`
- recent cumulative net: `-1,853,187` lamports
- recent inventory PnL: `-3,226,437` lamports
- recent fee capture: `1,462,084` lamports

Thus BcH's authoritative settlement is available and actually consumed during post-fix EsR3 evaluation. It has not yet been prospectively exercised in a competitive re-entry because EsR3 has not become `ENTRY_READY` after resumption.

The latest authoritative historical settlement versions are retained: HVE v2 `-1,925,242`, Bhh v2 `+320,468`, Drb v2 `-406,220`, 8G992 v3 `-32,525`, and BcH v1 `-1,853,187` lamports. The EsR3 context's declared `UTC_DAY` bounded window currently uses BcH; older settlements are not replaced by obsolete versions.

## Candidate diversity and validation depth

| Metric | Pre-blocker canonical cohort | Post-fix cohort |
| --- | ---: | ---: |
| Cycles | 110 | 27 |
| Distinct candidate-producing pools | 3 | 0 |
| EsR3 candidate share | 75.61% | n/a (no candidates) |
| Genuine multi-candidate cycles | 3 | 0 |
| Zero-candidate rate | 65.45% | 100.00% |

The three valid pre-blocker competitions remain valid evidence: ErwEe beat EsR3 once; 8Csg beat EsR3 twice; canonical winner ranking passed 3/3. No additional competitive cycles have been accumulated after P7 resumed, so cumulative genuine multi-candidate depth remains `3 / 5` minimum.

Candidate diversity is **insufficient evidence** post-fix: the selector is continuously evaluating multiple pools, but the current short cohort has not formed even one valid candidate. EsR3 is not dominating post-fix candidate formation because no pool has formed a candidate; it is instead one of the repeatedly evaluated pools still WARMING.

## Judgment

The P7 superseded-debt repair is operating correctly: global cycles resumed, P7 remains out of `RECOVER_ONLY`, and entry dispatch remains disabled. The present limitation is candidate/evidence maturity, not a recurrence of the P7 debt blocker and not a global-ranking failure.

Entry-authority readiness: **NOT_READY**. Required before a separate enablement decision: additional genuine multi-candidate cycles (at least two more to reach the prior five-cycle minimum), continued ranking correctness, and a post-BcH EsR3-versus-other-pool competition if market conditions produce one.

## No-change confirmation

- Code changed: no.
- Migration: none.
- Deployment/restart: none.
- Global selector, discovery, Candidate-Primary, P3/P4/P7 policy, pool-history policy, capital, and entry authority: unchanged.
- Shadow/research lanes created: no.
