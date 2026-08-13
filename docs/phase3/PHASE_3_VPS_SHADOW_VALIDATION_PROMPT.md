# LPForge Phase 3 VPS Shadow Validation Prompt

Deploy and validate the supplied LPForge `0.3.0-phase3` implementation. Do not redesign strategy logic and do not implement any transaction-signing path.

## Rules

1. Read `docs/phase3/LPForge_Phase_3_Implementation_Package_v1.0.md`, `docs/phase3/PHASE_3_SEQUENCE.md`, and `docs/evidence/phase3-stage-gates.md` first.
2. Keep `LIVE_SIGNING=false`.
3. Do not add a private key, seed phrase, signer, transaction builder, swap, claim, rebalance or liquidity write.
4. Install the pinned dependencies using the project-approved Node 24 LTS/pnpm environment and freeze the generated lockfile.
5. Start PostgreSQL, migrate a blank DB through M0009, rerun migration idempotency/evidence.
6. Run `typecheck`, `build`, all tests, P1/P2/P3 boundary checks and fixture shadow run.
7. Validate current Meteora program/SDK compatibility read-only.
8. Start collectors and persist enough live history to support 5m/15m/30m/1h/4h context and survival fitting.
9. Run Phase 3 in shadow/recommendation mode only. Every decision must be recorded before its outcome window.
10. Produce a forward evidence pack containing:
   - recommendation count and NO_TRADE count;
   - regime probabilities and realized-label/confusion methodology;
   - regime stability/transition report;
   - survival forecast calibration at 15m/30m/1h/2h/4h where sampleable;
   - candidate-family net LP outcome by Spot/Curve/BidAsk and range family;
   - fee vs adverse inventory attribution;
   - false-positive rate for recommendations;
   - missed-opportunity rate for NO_TRADE counterfactuals;
   - execution/signing boundary proof;
   - open data-quality/compatibility issues.

Stop and report if any gate fails. Do not progress to Phase 4 on a failing Phase 3 evidence gate.
