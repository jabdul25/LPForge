# LPForge P3 Ready → Zero Allocation / Operational Entry Not Ready Forensic V1

Status: LEGITIMATE_ZERO

Investigated incidents:

| Pool | Observed at | P3 | P4 | Requested | Available deployable | Allocated |
|---|---:|---|---|---:|---:|---:|
| `3C6q…YBXt` | 2026-09-05 03:47:33.873 UTC | ENTRY_READY | REJECT | 0.03 SOL | 0.123102406 SOL | 0 SOL |
| `68C6…nyajR` | 2026-09-05 03:03:33.639 UTC | ENTRY_READY | REJECT | 0.03 SOL | 0.123102406 SOL | 0 SOL |

## Finding

Capital was available. Both zero allocations were intentional consequences of
the candidate-specific P4 entry predicate, not a P7, wallet, reservation,
dispatch, selector, or snapshot failure.

`evaluateOperationalCycle` in
`packages/operational-runtime/src/index.ts` derives the allocation request with
`entryReady: entry.decision === 'ENTRY_READY'`. `allocateProductionCapital` in
`packages/capital-allocation/src/index.ts` then sets amount to zero and emits
`CAPITAL_ENTRY_NOT_READY` when that field is false. The operational result
subsequently emits `OPERATIONAL_CAPITAL_ALLOCATION_ZERO` and
`OPERATIONAL_ENTRY_NOT_READY`.

The P3 label has narrower semantics: it requires trustworthy historical
economics plus fresh live facts, but deliberately does **not** require the
collector's longer live-confirmation maturity. P4's `entry.decision` is the
stricter operational-entry evaluation. Therefore P3 ENTRY_READY is not itself
an assertion that P4 operational readiness is true.

## Exact incident replay

### 3C6q…YBXt

- P3: `ENTRY_READY`.
- P4 entry decision: `REJECT`.
- Entry reasons: `ENTRY_DATA_QUALITY_BLOCK`, `WAIT_RECLAIM_NOT_CONFIRMED`,
  `WAIT_VOLATILITY_EXPANSION`.
- Data completeness: `0.2362433333`, below required `0.60`.
- Economics uncertainty: `0.8062762423`, above permitted `0.72`.
- Support/reclaim strength: `0.1034922980`, below required `0.48`.
- Risk decision: `APPROVE` (`RISK_APPROVED`).
- Allocator input `entryReady`: false; allocator reason:
  `CAPITAL_ENTRY_NOT_READY`; allocation: zero.

### 68C6…nyajR

- P3: `ENTRY_READY`.
- P4 entry decision: `REJECT`.
- Entry reason: `ENTRY_DATA_QUALITY_BLOCK`.
- Data completeness: `0.1254633333`, below required `0.60`.
- Economics uncertainty: `0.7929360227`, above permitted `0.72`.
- Risk decision: `APPROVE` (`RISK_APPROVED`).
- Allocator input `entryReady`: false; allocator reason:
  `CAPITAL_ENTRY_NOT_READY`; allocation: zero.

## Dependency graph

```text
historical economics + fresh live facts ──> P3 ENTRY_READY
                                         
P4 entry facts ──> entry.decision ──> allocation entryReady
                                       └──> allocation > 0
                                              └──> operational entry readiness
                                                     └──> P4 ENTRY_READY
                                                            └──> global winner
                                                                   └──> dispatch / plan
```

`economicPlanDispatchAllowed` is not an input to allocation. In the first,
read-only global-selection probe it is intentionally false because P7 invokes
the operator with `LPFORGE_P7_PLAN_DISPATCH_ENABLED=false`. Only a durable
global winner is re-run in the second, identity-bound plan-preparation pass
with dispatch enabled. Neither candidate reached that pass.

## Controls

At both timestamps P7 was `PRODUCTION / HEALTHY / NORMAL` with
`newEconomicActionAllowed=true`. The allocation records showed wallet capital
`0.133102406 SOL`, reserve `0.01 SOL`, and deployable / remaining capital
`0.123102406 SOL`. Risk was approved, and no capital, pool, token, or global
limit reason appeared.

Historical positive control: 7t477 at 2026-09-05 00:09:04.668 UTC had
`entry.decision=ENTRY_READY`, allocation `0.03 SOL`, and
`CAPITAL_ALLOCATED`; it demonstrates that the same allocator produces a
nonzero allocation when P4's candidate-specific entry predicate is true.

## Conclusion

No implementation defect was proven. No code, configuration, or production
policy was changed. P4 correctly rejected both candidates before any capital
could be allocated. The concise P4 operational reason codes are downstream
symptoms; the authoritative root vetoes are the persisted entry-evaluation
facts above.
