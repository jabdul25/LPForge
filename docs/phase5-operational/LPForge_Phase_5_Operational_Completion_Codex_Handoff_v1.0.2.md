# Codex Handoff — LPForge Phase 5 Operational Completion v1.0.2

## Authority
You are validating an already-built cumulative LPForge Phase 1-5 release. Do not redesign strategy logic, relax gates, add mainnet signing, alter the canary cap, invent missing thresholds, or bypass reconciliation to obtain PASS.

Stop at the first failed mandatory gate. Preserve evidence, fix only the failing operational/deployment layer if the cause is host/runtime configuration, rerun the failed gate and affected regressions, then continue. If source-code change appears necessary, HOLD and report it instead of improvising.

## Gate 1 — Release and host preflight
From a fresh extraction:

```bash
sha256sum LPForge_Phase_1_to_5_Operational_Completion_v1.0.2.zip
./scripts/verify-release-integrity.sh
./scripts/vps-preflight.sh
pnpm install --frozen-lockfile
pnpm typecheck
pnpm build
node --test tests/*.test.mjs
node scripts/verify-phase1-boundary.mjs
node scripts/verify-phase2-boundary.mjs
node scripts/verify-phase3-boundary.mjs
node scripts/verify-phase4-boundary.mjs
node scripts/verify-phase5-boundary.mjs
node scripts/verify-migrations.mjs
```

Expected test count: 169 passed, 0 failed. Expected migrations: M0001-M0016.

Do not proceed if release integrity, host baseline, tests, boundaries, or migration lineage fails.

## Gate 2 — PostgreSQL 17
Apply M0001-M0016 to a fresh validation DB, then run:

```bash
DATABASE_URL='<validation-db>' node scripts/verify-phase5-postgres-contract.mjs
DATABASE_URL='<validation-db>' node scripts/verify-phase5-operational-postgres.mjs
```

Expected operational marker:
`PHASE5_OPERATIONAL_POSTGRES_OK ...`

## Gate 3 — Live shadow one-shot
Use the already validated mainnet read-only pool/RPC configuration. Keep:

```bash
LIVE_SIGNING=false
LPFORGE_LIVE_EXECUTION=false
LPFORGE_MAINNET_CANARY=false
LPFORGE_DATA_MODE=LIVE_READ_ONLY
```

Run repeatedly:

```bash
pnpm live:once
```

Early cycles may legitimately return `WARMING`. This is a PASS behavior; do not fabricate history. Continue enough forward observations to cross the explicit history gate.

Verify PostgreSQL rows in:
- `operations.forward_cycles`
- `operations.runtime_heartbeats`
- `research.shadow_recommendations`
- `research.regime_assessments`
- `research.lp_theses` when a thesis exists
- `research.entry_evaluations` when P4 is reached
- `research.risk_decisions` and `research.capital_allocations` when applicable

A NO_TRADE or WAIT is valid evidence. Do not force ENTRY_READY.

## Gate 4 — Continuous live runtime
Run:

```bash
pnpm live:shadow
```

Collect a sustained forward-data evidence window. Demonstrate multiple successful heartbeats/cycles, no future timestamps, no duplicate economic plans, and no signing/submission. Stop cleanly after evidence is captured.

If public operator addresses are intentionally supplied, P5 may persist BUILD_ONLY transaction plans. They are public keys only:

```bash
LPFORGE_OPERATOR_OWNER_ADDRESS='<public-address>'
LPFORGE_PREPARE_POSITION_ADDRESS='<public-new-position-address>'
```

Do not provide private keys to this runtime.

## Gate 5 — Devnet preflight
Switch only this validation shell/process to Devnet. Keep mainnet canary disabled and generic LIVE_SIGNING false:

```bash
export LPFORGE_CLUSTER=devnet
export SOLANA_RPC_HTTP_URL='<devnet-rpc>'
export LPFORGE_LIVE_EXECUTION=true
export LPFORGE_MAINNET_CANARY=false
export LIVE_SIGNING=false
export LPFORGE_DEVNET_EXECUTION_ACK=NON_REAL_ASSETS_ONLY
export LPFORGE_DEVNET_REFERENCE_RPC_URL=https://api.devnet.solana.com
```

Run:

```bash
pnpm devnet:preflight
```

The configured RPC genesis must match the reference Devnet genesis before any transaction authority is reachable.

## Gate 6 — Devnet recovery fixture
```bash
pnpm devnet:recovery-test
```

Required results include:
- UNKNOWN + valid blockhash -> WAIT_DO_NOT_RESUBMIT
- expired + economic effect ABSENT -> REBUILD_WITH_NEW_BLOCKHASH
- economic effect PRESENT -> reconcile, not resend
- expired + effect UNKNOWN -> HOLD_FOR_OPERATOR

## Gate 7 — Actual non-real-asset Devnet lifecycle
Run exactly one controlled validation cycle:

```bash
pnpm devnet:full-cycle
```

Expected chain:
PREFLIGHT -> Devnet faucet funding -> SIMULATE -> execution-risk APPROVE -> ephemeral SIGN -> durable PREPARED -> SUBMIT -> CONFIRM -> balance RECONCILE=MATCH.

The validation transaction transfers only 1 Devnet lamport to an ephemeral receiver. The signer secret must never be printed or persisted.

Capture signature, slot, simulation CU, confirmation state, and reconciliation delta from `operations.devnet_validation_runs` and Phase 5 submission tables.

If faucet rate limits block funding, HOLD that gate and report the RPC/faucet response. Do not replace the ephemeral signer with a mainnet-capable wallet.

## Gate 8 — PositionV2 read evidence
When a real Meteora Devnet PositionV2 address is available:

```bash
export LPFORGE_DEVNET_POOL_ADDRESS='<devnet-dlmm-pool>'
export LPFORGE_DEVNET_POSITION_ADDRESS='<position-v2-address>'
pnpm devnet:position-read
```

This gate is read-only. Record pool, position, owner, range and slot evidence. If no real PositionV2 address can be obtained, mark this gate PENDING rather than inventing one.

## Gate 9 — Final safety check
Return environment to:

```bash
LIVE_SIGNING=false
LPFORGE_LIVE_EXECUTION=false
LPFORGE_MAINNET_CANARY=false
```

Re-run Phase 5 boundary and API 405 safety smoke. Confirm zero mainnet signatures/submissions.

## Final decision
Return one of:
- PASS — connected live runtime plus actual Devnet sign/submit/confirm/reconcile all passed; PositionV2 evidence passed or is explicitly classified as a separate read-evidence open item that does not compromise transaction-lifecycle proof.
- PASS-WITH-OPEN-ITEMS — only non-safety evidence remains.
- HOLD — any safety, reconciliation, duplicate-prevention, runtime-integrity, or unknown-submission invariant failed.

Report exact command output, transaction signatures (Devnet only), slots, DB row counts, remaining blockers, and confirm `mainnet_transactions_sent=0`.
