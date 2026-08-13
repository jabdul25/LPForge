# LPForge Phase 2 Sequence

Phase 2 boundary: LP Economics Laboratory + Pool Intelligence baseline. No entry engine, no RangeForge winner selection, no signer, no transaction construction or submission.

| ID | Work item | Must deliver | Exit gate |
|---|---|---|---|
| P2-01 | Phase 2 contracts and schema | Research/simulation/assessment tables; Swap2Evt fee-side fields; bin fee-growth fields | M0007/M0008 static checks pass |
| P2-02 | Protocol math primitives | MM fee split, fee rounding, liquidity-share and withdrawal math, composition fee | Golden integer tests pass |
| P2-03 | Actual-position forensics | Position observation analysis, fee/inventory deltas, active-time/OOR | `ONCHAIN_POSITION` fidelity output tested |
| P2-04 | Synthetic bin-share replay | Deterministic inventory replay across bin frames | Replay/OOR/revisit tests pass |
| P2-05 | Swap2Evt fee attribution | Event-path fee allocation with fee-token side and explicit fidelity warning | Never reports path estimate as exact |
| P2-06 | Range outcome analytics | Active time, first passage, OOR side/count, max distance, revisit | Golden trajectory tests pass |
| P2-07 | Historical fee/volume ingestion | `/volume/history` typed adapter | Contract test passes |
| P2-08 | Fee sustainability | Active bucket ratio, mean/std/CV, trend, persistence | Stable-vs-burst fixture differentiates |
| P2-09 | Pool/token risk mapping | Meteora blacklist/freeze/holder/verification inputs | Hard-block tests pass |
| P2-10 | Flow toxicity baseline | Two-way flow, directionality, bins crossed, gaps, liquidity collapse | Toxic one-way fixture is not eligible |
| P2-11 | Pool intelligence baseline | Quality/economic/flow/liquidity/token scores + archetype + reasons | Healthy fixture can qualify; blocked fixture explains why |
| P2-12 | Research/counterfactual framework | Chronological split, lookahead guard, experiment hashing, counterfactual runner | Reproducibility tests pass |
| P2-13 | Lab CLI/read-only API | Fixture report, live-pool inspection, capabilities | Read-only boundary proven |
| P2-14 | Phase 2 evidence/exit | Regression + P2 tests, boundary scan, migration proof, evidence pack | PASS / PASS-WITH-ENVIRONMENT-OPEN-ITEMS / HOLD |
