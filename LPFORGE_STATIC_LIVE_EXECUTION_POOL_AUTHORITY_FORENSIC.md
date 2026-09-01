# LPFORGE — Static Live-Execution Pool Authority Forensic

## Scope

Read-only forensic. No source, database, deployment, runtime, policy, entry-authority, or execution change was made.

## Executive conclusion

The four live entries on 2026-08-31 did **not** derive their pool from `global-pool-selection-v1`. They all predate the first persisted global-selection cycle and have no global-cycle/winner provenance. Their executable pool was the P7 deterministic one-pool probe target, drawn from the static execution-policy universe. That target was EsR3 on all four plans.

The current global-selector code has a different handoff: it passes the durable winner's `poolAddress` and candidate ID to the final plan-construction pass. Entry authority is currently disabled, so that path has not created a live post-global-selector entry.

## Static policy

`policies/live-execution-policy.json` has five configured execution-policy pools:

1. `2VHM9pTZEU6pqeZoiNi8ZCeyerqhRYgS5Um7U8AEKrd9`
2. `AeUfFU6LU159YSBQvhLbXmh5bW2BqCgAFi5zUSQMnUc7`
3. `8CsgJcQ6YCE93wYiZW21gKF7a9HrTvW7WjwKaKt9cFDp`
4. `EsR3gRxMtqt3bBhDDsuY3SFyYNYvYzszzG9KVYpcQfs7`
5. `AUvX4hEMi9t43aqovA5tEAA5AZ7yugcpHa8SkJVEoEKa`

EsR3 was already in the versioned policy at the entry-era commit `1606c11af4c6bd0791cd100ebb4898dc1da63b08`.

The policy loader is `loadDeploymentPolicyFile` in [deployment-policy](/root/systems/LPForge/packages/deployment-policy/src/index.ts:23). Its `pools` field is consumed by `productionPoolAddresses` in [phase7-production-service](/root/systems/LPForge/packages/phase7-production-service/src/index.ts:218).

## Historical entry provenance

| Entry | Entry time UTC | Executed / lifecycle pool | P7 probe target | Plan pool provenance | Global cycle / winner |
| --- | --- | --- | --- | --- | --- |
| Drb | 06:22:41.404 | EsR3 | EsR3 | `provenance.poolAddress=EsR3` | none |
| Bhh | 08:18:22.572 | EsR3 | EsR3 | `provenance.poolAddress=EsR3` | none |
| HVE | 13:04:30.431 | EsR3 | EsR3 | `provenance.poolAddress=EsR3` | none |
| BcH | 20:22:13.080 | EsR3 | EsR3 | `provenance.poolAddress=EsR3` | none |

Each entry plan has an authenticated P7 control binding. The linked P7 control has `decisionHealthProbePoolAddresses=[EsR3]` and `decisionHealthPoolAddress=EsR3`. The plan, the operational P3/P4 forward cycle, and the created position all use that same address.

The first persisted production global-selection cycle is `2026-08-31T22:19:43.325Z`, after BcH. Consequently a matching EsR3 address cannot be treated as global-selector authority for any of these four entries.

## Old execution path

At the time of the four entries, P7 built `evaluationPoolAddresses` from `productionEvaluationPoolAddresses`, whose fixed baseline is `policy.pools`. It then invoked `phase7BoundedDecisionHealthProbePoolAddresses`, which schedules exactly one deterministic target, and passed that address as `LPFORGE_SMOKE_POOL_ADDRESS` into the operator. The operator constructs the operational cycle and plan against `cfg.smokePoolAddress`.

The source path was therefore:

```text
live-execution-policy.json pools
  -> productionEvaluationPoolAddresses
  -> one deterministic P7 probe target
  -> LPFORGE_SMOKE_POOL_ADDRESS
  -> Candidate-Primary / P3 / P4 for that pool
  -> authenticated execution plan pool
```

Discovery could augment the observation/evaluation set only after the bounded ACTIVE/ready admission path. It did not provide a global cross-pool selection authority for these entries.

## Current global-selector path

Current `runProductionGlobalSelectionCycle` evaluates its configured eligible set, persists the global cycle and winner, then only the winner's address is passed to the final construction pass:

```text
globalSelection.selection.winner.poolAddress
  -> runAutonomousDecisionProbe(..., poolAddress=winner.poolAddress)
  -> LPFORGE_SMOKE_POOL_ADDRESS
  -> final Candidate-Primary identity check
  -> plan persistence
```

See [winner handoff](/root/systems/LPForge/packages/phase7-production-service/src/index.ts:343). The operator rejects a changed per-pool candidate identity rather than substituting another pool.

There is no current `winner?.pool ?? configuredPool` fallback at the winner-to-plan boundary: no global winner means `GLOBAL_NO_TRADE`. However, static policy pools remain always included in the global evaluation universe and remain independently accepted by the Phase-6 execution allowlist. A dynamic pool can also be admitted at Phase 6 only when it remains a fresh ACTIVE Tier-A production candidate satisfying the production-admission rules.

## Classification

- Yesterday's live pool authority: `STATIC_EXECUTION_TARGET_WITH_DISCOVERY_OBSERVATION_ONLY`.
- Current future winner-to-plan authority: `GLOBAL_SELECTOR_AUTHORITY`, conditional on a valid global winner and entry authority being enabled.
- Static policy purpose today: both baseline global-evaluation membership and execution allowlist; it is not merely health-check metadata.
- Historical global-selector provenance: absent by chronology, not merely incomplete serialization.

## No-change confirmation

- Code changed: no.
- Migration/deployment: none.
- Entry authority: remains disabled.
- No transaction submitted; no lifecycle or position altered.
