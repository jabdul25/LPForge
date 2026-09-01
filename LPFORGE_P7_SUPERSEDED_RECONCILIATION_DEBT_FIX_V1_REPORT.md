# P7 superseded reconciliation debt fix v1

## Incident and root cause

Production global selection stopped at 2026-09-01T00:19:10.340Z even while discovery continued. P7's `runPhase7ProductionOnce()` returned before `runProductionGlobalSelectionCycle()` because `loadPhase7RecoveryFacts()` counted every latest non-`MATCH` plan reconciliation as active debt.

BcH's retired parent close plan, `plan-56116daf25db4ec3ad1cd6904483825b`, retained this audit row:

- reconciliation ID: `plan-56116daf25db4ec3ad1cd6904483825b:tx-1-8d700caf4d55ded118e92cef4b97ce5d-56116daf25db4ec3ad1cd6904483825b`
- observed: 2026-09-01T00:17:47.636Z
- status: `UNKNOWN`
- reason: `P6_SEQUENCE_CHAIN_TRUTH_PENDING`

That row is historical evidence, not live debt. BcH's lifecycle is `SOL_SETTLED` at 2026-09-01T08:31:44.147Z and its later account-close-only successor has lifecycle external reconciliation `RECONCILED_CHAIN` at the same timestamp.

## Corrected semantics

`p7-lifecycle-aware-reconciliation-debt-v1` derives blocking debt rather than changing historical rows. A non-MATCH plan reconciliation is superseded only when all of these are true:

1. It is linked to a `SOL_SETTLED` lifecycle.
2. A later lifecycle-level external reconciliation is `RECONCILED_CHAIN`.
3. The lifecycle reconciliation is later than the plan artifact.
4. No linked execution journal is still `SIGNED`, `SUBMITTED`, `UNKNOWN_SUBMISSION`, or `CONFIRMED` after that authority point.
5. No later plan reconciliation for that lifecycle remains non-MATCH.

Anything else remains blocking. The old BcH UNKNOWN row remains in `execution.reconciliations`; it is reported as superseded history rather than deleted or rewritten.

## Implementation

- Source before: `456ef11cd82ebbf3576255ca98f8e54977f42e99`
- Source after: `23d6f9f22a7c5273f4c66fbee287c483903ea6c4`
- Migration: none; classification is derived from existing lifecycle, link, reconciliation, and execution-journal evidence.
- Changed only: P7 reconciliation-debt derivation/visibility and focused tests.
- Unchanged: global selector, Candidate-Primary, discovery, scheduler, P3/P4, OOR, capital, settlement semantics, and entry policy.

The runtime now persists both `unresolvedReconciliationDebt` and `supersededReconciliationHistoryCount`. P7's recovery gate reads only the former.

## Safety coverage

Focused tests prove that OPEN/CLOSING lifecycles, absent authoritative reconciliation, lifecycle reconciliation UNKNOWN/FAIL, newer unresolved effects, and unrelated lifecycle debt remain blocking. The BcH fixture proves a later `SOL_SETTLED` / `RECONCILED_CHAIN` lifecycle makes the earlier parent UNKNOWN nonblocking while retaining it for audit. A P7 runtime with only superseded history remains `OBSERVE_ONLY`, not `RECOVER_ONLY`.

Focused P7 tests: 24/24 passed. Canonical CI: 936/936 passed, 0 failed. Release integrity passed with M0069 as migration head.

## Deployment and validation

Immutable artifact: `LPForge_Production_23d6f9f22a7c.tar.gz`

- artifact SHA-256: `4553add0cc625931deeba25c16973a22bfaf83acb1e8259cab09b611c9d461ab`
- build identity: `1a688721453685ca7fe8a231d0159850844d35151f62887c29249b42c6d66822`
- only `lpforge-production` was deployed/restarted
- the production environment retained Helius RPC configuration and `LPFORGE_GLOBAL_POOL_SELECTION_ENTRY_DISABLED=true`

Post-deploy state at 2026-09-01T18:06:40Z:

- BcH lifecycle: `SOL_SETTLED`
- BcH lifecycle reconciliation: `RECONCILED_CHAIN`
- active reconciliation debt: 0
- superseded reconciliation history: 1
- active positions: 0
- active plans: 0
- new submission attempts since deploy: 0
- P7: `OBSERVE_ONLY` with `P7_RUNTIME_CONTROL_DECISION_BLOCK`; it is no longer `RECOVER_ONLY` for BcH.

## Validation timeline correction

The earlier 110-cycle cohort ended at 00:19 UTC and must not be treated as continuous validation. The validation-resume timestamp is **2026-09-01T18:03:16.274Z**.

Nine fresh global cycles were persisted on the new release by 18:07 UTC:

| Completed UTC | Outcome | Coverage | Eligible / evaluated / candidates |
|---|---|---|---|
| 18:03:16.274 | GLOBAL_NO_TRADE | INCOMPLETE | 7 / 5 / 0 |
| 18:03:51.515 | GLOBAL_NO_TRADE | COMPLETE | 7 / 7 / 0 |
| 18:04:18.165 | GLOBAL_NO_TRADE | COMPLETE | 6 / 6 / 0 |
| 18:04:46.864 | GLOBAL_NO_TRADE | COMPLETE | 7 / 7 / 0 |
| 18:05:23.383 | GLOBAL_NO_TRADE | COMPLETE | 7 / 7 / 0 |
| 18:05:54.334 | GLOBAL_NO_TRADE | COMPLETE | 7 / 7 / 0 |
| 18:06:24.209 | GLOBAL_NO_TRADE | COMPLETE | 7 / 7 / 0 |
| 18:06:55.803 | GLOBAL_NO_TRADE | COMPLETE | 7 / 7 / 0 |
| 18:07:36.853 | GLOBAL_NO_TRADE | COMPLETE | 7 / 7 / 0 |

These no-trade outcomes are candidate/economic outcomes, not recovery suppression. Prior three genuine multi-candidate competitions remain preserved as pre-blocker evidence; post-fix validation begins at the resume timestamp above.

## No-shadow / no-policy statement

No shadow or research lane was created. Entry dispatch remains disabled. No transaction was submitted by this deployment or its validation cycles.
