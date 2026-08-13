# LPForge Phase 4 Release Notes v1.0

Phase 4 adds paper-only entry timing, capital/risk governance and full simulated position-management intelligence on top of the Phase 1–3 foundation.

Key rule: **Phase 4 can recommend and simulate HOLD/RESHAPE/REBALANCE/REDUCE/CLOSE, but cannot build, sign or send a transaction.**

Final local gate: 112/112 tests PASS; P1–P4 boundaries PASS; M0001–M0010 PASS.

## PostgreSQL runtime validation addendum — 12 August 2026

A real PostgreSQL 17.10 cluster was initialized in the sandbox and LPForge M0001–M0010 were applied to a blank database. Representative persistence and database-guard contracts were exercised. This exposed and corrected one real defect in `insertBins()` where its `ON CONFLICT` target did not match the `protocol.bin_snapshots` primary key. A permanent regression test and portable `scripts/verify-postgres-runtime.sh` were added. Final regression result: 113/113 tests PASS.
