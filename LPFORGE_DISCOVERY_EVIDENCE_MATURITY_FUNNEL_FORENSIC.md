# Discovery → evidence maturity funnel forensic

Status: PARTIAL, read-only. Global candidate records cover 2026-08-31T22:18:53Z through 2026-09-01T00:19:10Z; discovery observations are not durably timestamped in that window, so an exact same-window raw-discovery/pre-filter funnel cannot be reconstructed without fabricating data.

## What the durable evidence proves

- 110 global cycles, 8 distinct pools operationally evaluated, and 3 distinct candidate-producing pools.
- Candidate states: 217 WARMING, 307 EXCLUDED_STALE, 64 NO_TRADE, 20 NO_VALID_CANDIDATE, 3 REJECTED, 41 INCLUDED.
- Current discovery registry breadth is not intrinsically three pools: 2 ACTIVE_CANDIDATE, 10 QUALIFIED, 13 PREFILTERED, 42 OBSERVING, and 1,750 REJECTED pools.
- Evidence capacity observations show serviceable capacity fixed at 2, mean active count 1.11, mean qualified waiting 7.02, and maximum active count 2. This is a material upstream capacity/promotion bottleneck.

## Funnel conclusion

The durable evidence does **not** prove raw discovery is narrow. It proves a broad registered universe is compressed before operational maturity: only two active evidence slots serve a qualified waiting population averaging seven. The major candidate-side loss is WARMING/staleness rather than Candidate-Primary: 217 WARMING and 307 stale records vastly exceed the 41 included candidates.

EsR3's advantage cannot yet be attributed definitively to unfair refresh service because per-pool refresh timestamps and scheduler service order were not persisted alongside this global-cycle cohort. It may be genuine activity/evidence maturity, capacity prioritization, or both. The exact source-level next forensic target is the active-candidate evidence lease/rotation persistence path, not global ranking.

## Classification

Primary root cause: `MULTIPLE / MIXED`, led by `COLLECTOR_CAPACITY / SCHEDULER` and `OPERATIONAL_EVIDENCE_MATURITY`; `TTL / STALENESS ARCHITECTURE` is strongly indicated but cannot be partitioned into expiry-versus-delay without missing timing provenance.

No code, database, deployment, policy, entry-authority, shadow, or research-lane change was made.

## Freshness addendum — 2026-09-01T17:43Z

This report's original global-selector cohort ends at **2026-09-01T00:19:10Z**.  A fresh read-only production check at 17:43Z established that it has not accumulated further global-selection evidence:

- `execution.production_global_selection_cycles`: still **110** rows; newest completion remains **00:19:10Z**.
- Discovery remains live: the newest discovery observation is **17:34:22Z** and evidence-capacity observation is **17:38:27Z**.
- The current registry is **2 ACTIVE_CANDIDATE, 13 QUALIFIED, 12 PREFILTERED, 40 OBSERVING, 1,784 REJECTED**.
- The running `lpforge-production` daemon is the older `b7b8903…` release and is recording only P7 `RECOVER_ONLY` runtime ticks.  Its current reason is `P7_DAEMON_RECONCILIATION_DEBT` with debt count **1**.
- That debt is associated with unresolved legacy `P6_SEQUENCE_CHAIN_TRUTH_PENDING` reconciliation rows, including historical plan evidence.  All eight lifecycle rows are nevertheless `SOL_SETTLED`, and no lifecycle chain-reconciliation row is currently non-`RECONCILED_CHAIN`.

Therefore the prior 110-cycle funnel remains the last valid global-selector cohort; it is **not** a 17-hour continuous observation window.  No conclusion about current candidate dominance, refresh fairness, or post-midnight candidate competition may be drawn until canonical global cycles resume.  This is a runtime observability/operational-state gap distinct from the upstream maturity-concentration finding; no remediation was performed in this read-only audit.

### Exact runtime stop condition

The fresh check identified the precise blocker.  `packages/phase7-production-service/src/index.ts`, `runPhase7ProductionOnce`, returns before calling `runProductionGlobalSelectionCycle` whenever `loadPhase7RecoveryFacts` reports reconciliation debt.  The debt query in `packages/db/src/index.ts`, `loadPhase7RecoveryFacts`, counts the latest `execution.reconciliations` status for every plan where `status <> 'MATCH'`, without excluding a retired parent plan whose lifecycle has since reached a reconciled terminal state.

The sole current non-MATCH latest plan is BcH's **retired parent** `plan-56116daf25db4ec3ad1cd6904483825b`, whose 2026-09-01T00:17:47Z row remains `UNKNOWN / P6_SEQUENCE_CHAIN_TRUTH_PENDING`.  Its authenticated account-close-only successor is independently `MATCH` at 08:31:43Z, and BcH itself is `SOL_SETTLED` with `RECONCILED_CHAIN`.  Consequently this is a false-positive, permanently blocking reconciliation-debt classification—not a no-op market observation and not unresolved economic exposure.

No repair was performed here.  The narrowly scoped canonical fix should make P7 debt accounting lifecycle/effect aware: retain genuinely unresolved action debt, but exclude superseded parent-plan reconciliation rows once their lifecycle has an authoritative terminal reconciliation.  It must not weaken settlement reconciliation or release entry authority.
