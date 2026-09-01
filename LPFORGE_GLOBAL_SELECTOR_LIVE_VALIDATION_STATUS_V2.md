# Global selector live validation status v2

Read-only cutoff: 2026-09-01T08:31:44Z (latest BcH settlement); no code, DB, deployment, or policy changes.

## Runtime

- Execution runtime: `456ef11cd82ebbf3576255ca98f8e54977f42e99`; migration head `M0069_production_global_candidate_contract.sql`.
- Active positions: 0; slot: FREE; entry authority remains disabled.

## Cohort

There are 110 persisted production global cycles from 2026-08-31T22:19:43Z through 2026-09-01T00:19:10Z. Using the prior 20-cycle report as baseline leaves 90 new cycles: 24 `GLOBAL_WINNER`, 66 `GLOBAL_NO_TRADE`, and 3 genuine multi-candidate cycles. Cumulative outcome: 24 winners, 86 no-trade, 3 multi-candidate cycles.

## Multi-pool evidence

All three genuine competitions had complete 5/5 or 7/7 evaluation coverage and selected a winner over EsR3:

| Time UTC | Winner | Runner-up | Eligible/evaluated |
| --- | --- | --- | --- |
| 2026-08-31 23:24:10 | ErwEe…vfdw | EsR3…Qfs7 | 7 / 7 |
| 2026-09-01 00:12:44 | 8Csg…cFDp | EsR3…Qfs7 | 5 / 5 |
| 2026-09-01 00:13:48 | 8Csg…cFDp | EsR3…Qfs7 | 5 / 5 |

The first is the previously documented ErwEe (+0.000363701 SOL risk-adjusted EV) versus EsR3 (+0.000011418 SOL). The two new cycles demonstrate EsR3 losing global rank rather than receiving a probe privilege. Candidate records contain the risk-adjusted EV, strategy/range, freshness, and pool-history context needed to explain the ranking.

## Caveats and readiness

The target evidence depth is 5–10 genuine multi-candidate cycles; cumulative evidence is 3/5 minimum. The latest persisted global cycle predates BcH settlement, so BcH's corrected `-1,853,187` lamport result is authoritative in settlement data but has not yet been observed in a subsequent EsR3 global candidate context. Historical corrected outcomes remain available to the pool-history derivation; no obsolete settlement is required.

No-trade remains principally evidence/gate driven: persisted candidate states are 217 WARMING, 307 EXCLUDED_STALE, 64 NO_TRADE, 20 NO_VALID_CANDIDATE, 3 REJECTED, and 41 INCLUDED. This is fail-closed, but the absence of cycles after 00:19Z means prospective validation is currently stale.

Conclusion: ranking behavior is consistent for the three multi-candidate cycles, including two EsR3 losses, but validation is NOT_READY for entry authority: only 3/5 required competitions and no post-BcH recurrence competition exist.
