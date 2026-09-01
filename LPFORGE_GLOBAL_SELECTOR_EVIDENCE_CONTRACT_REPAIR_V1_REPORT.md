# LPForge Global Selector Evidence Contract Repair V1

## Executive finding

The global selector was correct to fail closed, but its input was not the
authoritative operational result. It read optional research/recommendation
rows; WARMING exits do not create those rows and valid operational candidates
could also lose their capital basis at that reporting boundary. This produced
false `EXCLUDED_STALE` / incomplete coverage rather than the pool's real state.

`production_global_candidates` is now the canonical Production decision
evidence contract. Every operational pool result is written to it before any
reporting/recommendation-specific persistence. The selector reads only this
per-global-cycle contract.

## Old and corrected data flow

Old:

```
operational result -> optional recommendation/thesis rows -> global selector
```

Corrected:

```
operational result -> normalized production_global_candidates -> global selector
```

The normalizer preserves `ENTRY_READY`, `NO_TRADE`, `WARMING`, and `REJECTED`,
including the operational reason codes. It carries Candidate-Primary strategy,
range, decision-time active bin, the fixed capital basis from
`forwardValidation.capitalValue`, horizon, absolute economics, uncertainty,
confidence, OOR risk, and evidence/provenance payload. The prior capital-loss
path is removed: an ENTRY_READY result either contains canonical capital,
horizon, and risk-adjusted EV, or is retained with the explicit reason
`GLOBAL_ENTRY_READY_METRICS_INCOMPLETE`.

## Scope preservation

Candidate-Primary, P3, P4, P7, execution construction, OOR, and live position
management are unchanged. M0069 adds only the append-only Production evidence
table `execution.production_global_candidates`; it creates no shadow or
research tables.

## Validation

Before the repair, the zero-candidate forensic measured 36 cycles, zero global
winners, 36 `GLOBAL_NO_TRADE`, 171 WARMING outcomes, and 20 ENTRY_READY
outcomes discarded at the old contract boundary.

After deployment, the first completed new global cycle persisted five canonical
WARMING rows for its five successfully evaluated pools. Their operational
reason codes remain visible (for example
`OPERATIONAL_EVIDENCE_MATURITY_PENDING`), rather than being rewritten as stale
recommendations. A following cycle was still in progress at the forensic
cutoff. There were no post-deploy ENTRY_READY candidates, so there was no
multi-candidate ranking cohort yet; this is current evidence maturity, not a
selector contract failure. The completed post-deploy cycle remained
`GLOBAL_NO_TRADE` with entry authority disabled; a following cycle was still
in progress.

## Tests and release

- Focused global selector/service tests: 21/21 passed.
- Canonical CI: 928/928 passed, including migration and boundary verification.
- Release: `b7b8903daea7d85eaf3048d84a17b5d297dc7884`.
- Artifact integrity passed; M0069 applied successfully.
- `LPFORGE_P7_PLAN_DISPATCH_ENABLED=false` and
  `LPFORGE_GLOBAL_POOL_SELECTION_ENTRY_DISABLED=true` remain set.

The open BcH position was only read during verification; it was not closed,
rebalanced, executed, accounted, or otherwise mutated.

## Remaining validation evidence

The contract plumbing is complete. Promotion of entry authority remains out of
scope. Before that separate decision, collect a read-only cohort containing
at least two simultaneous canonical ENTRY_READY pool candidates and verify the
persisted global ranking/winner and no-trade behavior under the repaired
contract.
