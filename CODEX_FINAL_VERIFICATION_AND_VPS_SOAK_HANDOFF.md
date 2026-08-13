# LPForge Final Verification and VPS Read-Only Soak Handoff

## Objective
Independently verify this exact release. If and only if every required gate passes, deploy it to the VPS in read-only production soak mode for multiple days. Do not redesign, loosen thresholds, or enable capital deployment.

## Mandatory read-only posture
- LIVE_SIGNING=false
- LPFORGE_LIVE_EXECUTION=false
- LPFORGE_MAINNET_CANARY=false
- LPFORGE_P7_AUTHORITY_MODE=OBSERVE_ONLY
- LPFORGE_P6_CANARY_CAPITAL_LAMPORTS=0
- Phase-6 operator approval fields empty

Before PM2 starts, `pnpm canary:assert-read-only` MUST PASS and `pnpm canary:gate-status` MUST show `capitalDeploymentAuthorized=false`.

## Verification sequence
Private RPC is **not required** for integrity/static/build/database verification (steps 1-9). Request the read-only private RPC only after those gates PASS and immediately before live read-only configuration/soak preparation.

1. Verify outer archive SHA-256 and all embedded SHA256SUMS entries.
2. Verify SOURCE_REVISION.txt/source bundle consistency.
3. Install exactly from pnpm-lock.yaml; do not update dependencies.
4. Run `pnpm test:ci` and all P1-P7 boundaries/migration verification.
5. Apply migrations to a disposable PostgreSQL database from zero, then verify upgrade against a copy of the existing LPForge DB.
6. Run local Meteora lifecycle verification where supported.
7. Run `pnpm canary:capabilities`, `pnpm canary:gate-status`, and `pnpm canary:assert-read-only`.
8. Confirm the live path is wired end-to-end: READ_ONLY -> BUILD -> SIMULATE -> PRESIGN -> SIGN -> SUBMIT -> RECONCILE_OPEN -> MONITOR -> CLOSE/EMERGENCY_CLOSE -> RECONCILE_CLOSE -> RECOVERY, while the authorization membrane prevents SIGN/SUBMIT in soak posture.
9. Confirm no Phase-6/Phase-7 module gained a bypass signer/sender and no HTTP execution endpoint exists.
10. Populate `.env` from `.env.production.example` with real DATABASE_URL, private read RPC, smoke pool, runtime identity, approved drift baseline, source commit, and optional Telegram credentials. Keep all live/canary flags false.
11. Register release evidence only after the exact source revision passes full regression.
12. Run `pnpm production:once`; verify health, drift, control, runtime cycle and evidence rows persist and transaction/submission/canary counts remain zero.
13. Start with `pnpm pm2:start`. PM2 must run one instance only.

## Soak requirement
Run continuously for at least 32 hours unless a critical blocker appears first. Preserve all evidence. Do not enable signing/execution/canary during soak.

During soak verify:
- process uptime/restart behavior and single runtime lease holder;
- no duplicate forward/runtime cycles;
- no future timestamps/lookahead;
- real mainnet pool/swap evidence continues to ingest;
- regime/NO_TRADE/ENTER recommendations persist correctly;
- health and drift assessments continue to populate;
- Telegram alerts fire on testable non-capital events without exposing secrets;
- zero transaction submissions, confirmations and canary sessions;
- zero unresolved reconciliation debt;
- database growth, memory and CPU remain operationally acceptable;
- restart recovery is fail-closed.

## End-of-soak decision
Produce PASS/HOLD/BLOCK with evidence. PASS means the system is operationally ready to proceed to a separately approved tiny mainnet-canary programme. PASS does NOT authorize capital and must not change any live-execution flag.
