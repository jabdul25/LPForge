# LPForge Phase 4 PostgreSQL Runtime Verification

**Date:** 2026-08-12  
**Database engine:** PostgreSQL 17.10 (Debian 17.10-1.pgdg13+1), x86_64  
**Environment:** Debian 13 sandbox, isolated extracted PostgreSQL root; no systemd/Docker required  
**Result:** PASS

## What was verified

1. All 87 supplied Debian 13 package checksums passed.
2. PostgreSQL 17.10 binaries executed successfully against the sandbox's Debian 13 runtime.
3. A fresh standalone PostgreSQL cluster was initialized and started on `127.0.0.1:55432`.
4. A blank `lpforge_phase4_test` database accepted M0001 through M0010 in order.
5. The migration ledger contains all 10 migration checksums.
6. The resulting LPForge database contains 32 tables across `protocol`, `market`, `features`, `accounting`, `governance`, and `research`.
7. Representative persistence writes passed for protocol, market, feature, accounting, research, Phase 3 recommendation/thesis, and Phase 4 paper-management tables.
8. Database guards correctly rejected:
   - mutation of the append-only migration ledger;
   - a paper position whose lower bin exceeded its upper bin;
   - a pool assessment with toxicity probability greater than 1.
9. A real-database contract test exposed an `insertBins()` conflict-target defect. The adapter used `(pool_address, bin_id, chain_slot, observed_at)` while the table primary key is `(pool_address, bin_id, observed_at)`. The adapter was fixed and a permanent regression test was added.
10. After the fix, duplicate bin insertion is idempotent and the runtime database contract passes.

## Final regression result

- Automated tests: **113/113 PASS**
- Phase 1 boundary: PASS
- Phase 2 boundary: PASS
- Phase 3 boundary: PASS
- Phase 4 boundary: PASS
- Static migration verification: PASS
- Real PostgreSQL runtime migration: PASS
- Real PostgreSQL persistence contract: PASS
- Real PostgreSQL guard/constraint checks: PASS

## Remaining environment evidence

This closes the PostgreSQL runtime-validation gap. Still pending for full target-host/live-read evidence:

- installation of the repository's pinned Node/pnpm dependencies under the declared Node 24 baseline;
- execution of the actual Node `pg` driver migration/store path against PostgreSQL;
- live Solana/Meteora SDK and Data API reads;
- sustained Phase 3 shadow and Phase 4 paper operation against forward market data.

No live signing or state-changing Meteora path was introduced.
