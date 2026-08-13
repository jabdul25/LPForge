# LPForge Phase 7 Sequence — Production Operations, Scaling and Continuous Evaluation

Hard gate: **no later stage starts until the previous stage passes**. A stage failure is fixed and rerun before progression.

| Stage | Scope | Exit gate |
|---|---|---|
| P7-01 | Contracts, authority boundary, sequence and boundary scanner | strict TS/build + contract tests + P7 boundary PASS |
| P7-02 | Production authority/configuration and default-deny capability model | config/authority tests + no implicit live authority |
| P7-03 | Health/SLO aggregation across RPC, API, DB, decisions, execution and portfolio | deterministic health state + stale/degraded hard gates |
| P7-04 | Incident classification, circuit breakers and kill-switch orchestration | critical incident forces safe write suppression |
| P7-05 | Audited operator controls | all manual actions authorized, reason-coded and auditable |
| P7-06 | Production portfolio/exposure governor | global/pool/token/wallet budgets cannot be bypassed |
| P7-07 | Policy registry and promotion evidence bundle | immutable policy identity + complete promotion bundle |
| P7-08 | Policy rollback manager | deterministic rollback target + audited rollback, no hidden mutation |
| P7-09 | Canary → limited-live → production promotion evaluator | evidence-based HOLD/ELIGIBLE; no auto authority issuance |
| P7-10 | Scaling governor | bounded stepwise scale, cooldown and drawdown/reconciliation gates |
| P7-11 | Continuous evaluation and drift detection | forecast/decision/operational drift reason-coded and alertable |
| P7-12 | Learning/experiment proposal gate | research may propose; production policy cannot auto-promote |
| P7-13 | Backup/restore and disaster-recovery readiness | restore evidence + RPO/RTO readiness assessment |
| P7-14 | Production daemon/restart/idempotency orchestration | restart safe, recovery-first, duplicate economic action prevented |
| P7-15 | Runbooks, operator evidence and production evidence pack | required runbooks/evidence complete and hashable |
| P7-16 | Final P1–P7 exit review | full regression + boundaries + migrations + promotion status |

## Phase 7 safety rules

- Phase 7 is a control/operations layer; it does not implement a second signer or transaction sender.
- Existing Phase 5/6 execution and reconciliation remain the only state-changing path.
- `OBSERVE_ONLY` is the default authority.
- Limited-live and production modes require explicit, expiring operator approval.
- Policy promotion is never automatic.
- Scaling is disabled by default and may only become stepwise/bounded after explicit production evidence and authority.
- Any unresolved reconciliation debt blocks scale-up and promotion.
- Kill switches, pause controls and rollback are fail-closed and audited.
