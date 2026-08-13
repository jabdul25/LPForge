# LPForge Live Path Readiness

All Phase-6 mainnet-canary stages are now operationally surfaced: READ_ONLY -> BUILD -> SIMULATE -> PRESIGN -> SIGN -> SUBMIT -> RECONCILE_OPEN -> MONITOR -> CLOSE/EMERGENCY_CLOSE -> RECONCILE_CLOSE -> RECOVERY.

The underlying implementations remain the frozen Phase-6 modules. `packages/phase6-operational-gates` is the final default-deny authorization membrane. It does not sign or submit transactions; it proves whether all independent prerequisites for reaching those stages are present.

For the VPS read-only soak, the required posture is:

- `LIVE_SIGNING=false`
- `LPFORGE_LIVE_EXECUTION=false`
- `LPFORGE_MAINNET_CANARY=false`
- no Phase-6 operator approval envelope
- `LPFORGE_P7_AUTHORITY_MODE=OBSERVE_ONLY`

`pnpm canary:gate-status` must report `capitalDeploymentAuthorized=false`, and `pnpm canary:assert-read-only` must PASS before PM2 starts.

Capital authorization is deliberately a later operational act. It requires all three execution flags, configured private write RPC, explicit pool allowlist, positive bounded canary capital, configured non-exportable signer backend, and a non-expired explicit operator approval envelope. Existing RPC/wallet/pool/build/simulation/capital/pre-sign/reconciliation gates still apply afterwards; this membrane does not bypass them.
