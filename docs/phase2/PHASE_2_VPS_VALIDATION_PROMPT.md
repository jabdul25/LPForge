# LPForge Phase 2 VPS Validation Prompt for Codex

Do not redesign LPForge and do not implement Phase 3.

You are validating the already implemented LPForge Phase 1+2 repository on the target VPS.

1. Read `docs/phase2/LPForge_Phase_2_Implementation_Package_v1.0.md`, `docs/phase2/PHASE_2_SEQUENCE.md`, `docs/evidence/phase2-evidence.md`, and the authoritative architecture documents.
2. Install the repository's pinned Node/pnpm/dependencies and freeze the lockfile.
3. Run typecheck/build/all tests and both boundary scanners. Stop on failure.
4. Start blank PostgreSQL 17, apply M0001–M0008 and prove the complete migration chain.
5. Run fixture lab report.
6. Configure `LPFORGE_DATA_MODE=LIVE_READ_ONLY` with a read-only Solana RPC. Do not add a wallet/private key.
7. Verify protocol compatibility and run `lab live-pool <address>` on at least three current Meteora DLMM pools.
8. Start collector/observer long enough to capture real bin/swap history, then preserve evidence rather than tuning research thresholds.
9. If a suitable publicly readable PositionV2 example is available, capture repeated position observations for actual-position forensics. Never sign or mutate it.
10. Update `docs/evidence/phase2-evidence.md` with exact commands, versions, pool addresses, migration proof, test outputs, data-fidelity notes and PASS/PASS-WITH-OPEN-ITEMS/HOLD.

Prohibited: signer material, transaction construction/sign/send, liquidity add/remove, swap, claim, rebalance, entry decision, RangeForge winner selection, live-policy promotion.
