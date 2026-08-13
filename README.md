# LPForge Phase 1 — Implemented Foundation

LPForge Phase 1 is a **read-only Meteora DLMM observation, indexing, feature and accounting foundation**. It intentionally contains no transaction-signing or strategy-entry path.

## Phase 1 capabilities

- current Meteora SDK compatibility probe;
- `LbPair`/active-bin/bin-window/`PositionV2` read adapters;
- Meteora DLMM Data API client with centralized <=30 RPS limiter;
- Solana JSON-RPC scanner primitives and Anchor event-data extraction;
- PostgreSQL protocol/market/feature/accounting schema;
- deterministic bin, movement, flow and fee feature primitives;
- exact fixed-point token/position valuation primitives;
- read-only API and inspection CLI;
- fixture/replay mode;
- CI and Phase 1 boundary checks.

## Hard boundary

`LIVE_SIGNING=false` is mandatory. Phase 1 has no private-key configuration and no transaction send/sign methods.

## Bootstrap on a connected Node 24 host

```bash
corepack enable
pnpm install
cp .env.example .env
# edit DATABASE_URL / RPC and optional smoke addresses
pnpm typecheck
pnpm build
pnpm test:ci
pnpm db:migrate
pnpm observer -- capabilities
```

For deterministic offline verification after a build:

```bash
LPFORGE_DATA_MODE=FIXTURE pnpm phase1:fixture
```

For live read-only smoke tests:

```bash
export LPFORGE_DATA_MODE=LIVE_READ_ONLY
export LPFORGE_SMOKE_POOL_ADDRESS=<meteora_pool>
pnpm observer -- protocol-verify
pnpm observer -- pool-inspect <meteora_pool>
```

Position inspection requires pool and PositionV2 addresses.

## Phase boundary

Phase 2 intelligence (pool qualification, regime classification, opportunity/entry thesis, RangeForge) is **not implemented here**. Live execution is a much later gate.

## Phase 2 implemented baseline

Phase 2 extends the read-only Phase 1 foundation with the LP Economics Laboratory and Pool Intelligence baseline. It remains strictly non-executing.

Key commands after build:

```bash
node .build/apps/lab/src/main.js fixture-report
node .build/apps/lab/src/main.js live-pool <POOL_ADDRESS>
node scripts/verify-phase1-boundary.mjs
node scripts/verify-phase2-boundary.mjs
```

Research eligibility is not trading approval. Synthetic fee attribution is fidelity-labeled and cannot be represented as exact on-chain PnL. See `docs/phase2/LPForge_Phase_2_Implementation_Package_v1.0.md`.

## Phase 3 — Recommendation Intelligence

Phase 3 is implemented through P3-16. It adds multi-horizon market context, structure features, probabilistic regime intelligence, pullback specialists, net LP opportunity economics, empirical range survival, RangeForge Spot/Curve/BidAsk alternatives, Phase 2 candidate replay, risk-adjusted ranking where `NO_TRADE` competes with every candidate, machine-readable theses, shadow recommendations, and calibration/evaluation utilities.

Phase 3 remains read-only/recommendation-only. See `docs/phase3/` and `docs/evidence/phase3-stage-gates.md`.


## Phase 4
Phase 4 adds paper-only entry timing, risk/capital allocation and forward-EV position management. See `docs/phase4/` and `docs/evidence/phase4-evidence.md`. Live signing remains prohibited.


## Phase 5 — Controlled Execution
Phase 5 implements wallet truth, deterministic transaction planning, Meteora transaction construction, simulation/cost governance, execution-risk permits, signer isolation, durable submission/confirmation, reconciliation, recovery/idempotency, and guarded mainnet-canary eligibility. Default authority is BUILD_ONLY; live execution and mainnet canary are disabled by default. Implementation is PASS; operational promotion remains HOLD pending connected live-read and Devnet submit/confirm/reconcile evidence. See `docs/phase5/` and `docs/evidence/phase5-stage-gates.md`.

## Phase 5 operational-completion commands

Forward-data runtime (never signs/submits):

```bash
pnpm live:fixture
pnpm live:once
pnpm live:shadow
```

Devnet validation (non-real assets only, explicit operator acknowledgement required):

```bash
pnpm devnet:preflight
pnpm devnet:recovery-test
pnpm devnet:full-cycle
pnpm devnet:position-read
```

See `docs/phase5-operational/PHASE5_OPERATIONAL_COMPLETION_v1.0.2.md` and the Codex handoff in the same directory before running connected execution validation.

## Phase 5 local-validator execution lab

The Phase 5 operational release can be validated without Devnet using an isolated Agave validator. The generic recovery verifier proves real sign/submit/confirm/UNKNOWN-after-send/idempotency behavior. The local Meteora verifier is hard-gated to loopback RPC and requires the real DLMM program to be preloaded plus synthetic local token/pool addresses.

```bash
node scripts/verify-phase5-local-validator-recovery.mjs
pnpm verify:local:meteora
```

The local Meteora verifier refuses non-loopback RPC endpoints and refuses `LPFORGE_LIVE_EXECUTION=true` or `LPFORGE_MAINNET_CANARY=true`.

## Phase 6 — Controlled Mainnet Canary
Phase 6 adds a canary-only production authority layer, provider/wallet/pool truth gates, mainnet build/simulation validation, tiny-capital governance, pre-sign revalidation, isolated signing, exact PositionV2 reconciliation, conservative canary monitoring/close, recovery discipline, repeated-canary evidence and production-promotion evaluation. The implementation is complete; real-mainnet promotion remains gated by real canary evidence.

## Phase 7 — Production Operations, Scaling and Continuous Evaluation

Phase 7 is implementation-complete **and runtime-integrated**. It adds default-deny production authority, health/SLO aggregation, incident/kill-switch handling, audited operator controls, portfolio exposure governance, policy registry/promotion bundles, rollback, bounded scaling, drift evaluation, research-only learning proposals, disaster-recovery readiness, daemon recovery/idempotency, runbooks and final P1–P7 promotion evidence. The `apps/production` control-plane service now composes the existing read-only operator with live health, drift, incident/control, restart recovery, lease ownership and evidence persistence. Phase-7 modules never contain a direct signer or transaction-send path.

Production control-plane commands after build:

```bash
pnpm production:once
pnpm production:start
pnpm production:status
pnpm production:evidence
pnpm production:register-release-evidence
```

`production:start` forces the child operator to `LIVE_SIGNING=false`, `LPFORGE_LIVE_EXECUTION=false`, `LPFORGE_MAINNET_CANARY=false` and `LPFORGE_DATA_MODE=LIVE_READ_ONLY`, and removes execution owner/position addresses before launching it. Release implementation evidence must be hash-verified and source-revision matched before `P7-R10=PASS` can be registered in PostgreSQL. Production promotion remains HOLD pending genuine mainnet canary, limited-live and disaster-recovery operational evidence. See `docs/phase7/`, `LPForge_Phase_7_Stage_Gate_Report_v1.0.md`, `LPForge_Phase_7_Runtime_Integration_Stage_Gate_Report_v1.0.md` and `LPForge_Phase_7_Local_Verification_v1.0.md`.
