# LPForge Phase 4 VPS Paper Validation Prompt

Deploy and validate the supplied LPForge Phase 4 repository. **Do not redesign architecture and do not implement any live signer.**

1. Read `docs/phase4/LPForge_Phase_4_Implementation_Package_v1.0.md`, `docs/phase4/PHASE_4_SEQUENCE.md`, and `docs/evidence/phase4-stage-gates.md`.
2. Install the package.json-pinned dependencies using the project-approved Node/pnpm versions; generate/commit the lockfile if still absent.
3. Start PostgreSQL 17 and apply M0001 through M0010 from a blank database; rerun migrations to prove idempotent deployment behavior where the migration runner supports it.
4. Run typecheck, build, every test, P1/P2/P3/P4 boundary scripts and migration verification. Stop on any failure.
5. Run the P1–P3 live-read validations against current Meteora/Solana data. No signing.
6. Run `node .build/apps/paper/src/main.js fixture-once` and archive output.
7. Run the Phase 4 API in FIXTURE mode and prove `/health/live`, `/api/v1/capabilities`, POST=405, and `LIVE_SIGNING=true` startup refusal.
8. Run Phase 4 shadow/paper management against live-read market observations only. Persist entry evaluations, risk decisions, capital allocations, paper-position events, management decisions and portfolio snapshots. Do not send any Solana transaction.
9. Produce `docs/evidence/phase4-vps-evidence.md` with environment versions, migration proof, test results, live-read pool/position evidence, paper cycles, failures, and final `PASS / PASS-WITH-OPEN-ITEMS / HOLD`.

Explicitly prohibited: private keys, seed phrases, transaction signing/sending, live add/remove liquidity, live rebalance, swap, claim or live close.
