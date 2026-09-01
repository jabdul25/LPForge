# Single-candidate pool dominance forensic

Read-only cutoff: 2026-09-01T00:19:10Z, the latest canonical `global-pool-selection-v1` cycle. Cohort: 110 post-M0069 global-selection cycles.

## Cycle partition

- Zero valid candidates: 72 (65.45%)
- Exactly one valid candidate: 35 (31.82%)
- Two or more candidates: 3 (2.73%)
- Sole-candidate selections: 21
- Competitive global winners: 3

The difference between 35 sole-candidate cycles and 21 sole selections is legitimate fail-closed no-trade/coverage behavior; a sole candidate is not automatically an executed or competitive winner.

## Candidate funnel / concentration

| Pool | Included candidates | Sole candidate | Multi participation | WARMING | NO_TRADE |
| --- | ---: | ---: | ---: | ---: | ---: |
| EsR3…Qfs7 | 31 | 28 | 3 | 1 | 32 |
| 8Csg…cFDp | 9 | 7 | 2 | 44 | 4 |
| ErwEe…vfdw | 1 | 0 | 1 | 2 | 0 |
| piAs…xJk | 0 | 0 | 0 | 18 | 4 |
| AUvX…oEKa | 0 | 0 | 0 | 53 | 0 |
| AeUf…nUc7 | 0 | 0 | 0 | 54 | 0 |
| 2VHM…Krd9 | 0 | 0 | 0 | 31 | 22 |
| 3WY9…nDgY | 0 | 0 | 0 | 14 | 2 |

There are 41 candidate appearances. EsR3 supplies 31 (75.61%); it is present in 31 of 38 candidate-producing cycles (81.58%) and owns 28/35 sole-candidate cycles (80.00%). Candidate-pool HHI is approximately 0.62; top-2 concentration is 97.56%, top-3 is 100%.

EsR3 candidate strategy mix: CURVE/ONE_SIDED_Y 25, CURVE/SKEWED_Y 3, BID_ASK/SKEWED_Y 2, CURVE/BALANCED 1. This is primarily a pool-plus-shape concentration, not a balanced range of changing strategies.

## Interpretation

EsR3 has **HIGH** candidate-formation dominance. It does not dominate competitive selection: it lost all three multi-candidate cycles (ErwEe once; 8Csg twice). Thus the global ranking layer is doing its job when competition exists. The upstream funnel is concentrated because most other pools are WARMING or NO_TRADE, not because of a demonstrated selector defect. The dominant quantitative bottleneck is operational evidence maturity: 217 WARMING outcomes versus only 41 included candidate appearances across the cohort.

No code, DB, service, or policy change was made. Entry authority remains disabled.
