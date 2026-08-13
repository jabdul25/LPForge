# LPForge continuous autonomous live-path report

Generated: 2026-08-13T11:37:58Z  
Repository: `/root/systems/LPForge`  
Baseline implementation commit: `3b4f58e` (superseded by the lifecycle completion update below)

## Executive status

The LPForge live path is deployed as two separate PM2 services from this
repository:

| Service | PM2 state | Responsibility | Signing capability |
| --- | --- | --- | --- |
| `lpforge-production` | online | Collects live Meteora data, evaluates the autonomous strategy, and persists fresh `PLANNED` execution records when an entry is approved. | None |
| `lpforge-execution` | online | Atomically claims fresh PostgreSQL plans, builds/simulates/signs/submits the Jupiter and Meteora transactions, then records confirmation/reconciliation evidence. | Yes, via the configured local signer only |

As of generation time, the strategy has returned `NO_TRADE` on its recent
cycles. There are no pending mainnet plans, no submission attempts, no
signatures, and no on-chain transaction has been sent by this deployment.
`lpforge-execution` is therefore armed and waiting, rather than idle because
of a missing manual approval or an absent plan source.

## What was changed

### 1. Continuous autonomous plan source

The former manual execution-inbox concept was removed from the Phase 6
runtime. The execution worker now uses PostgreSQL as its sole plan source:

1. The production service runs `apps/operator` every collection interval.
2. The operator reads the configured Meteora pool, bins, data API, swap/event
   history, historical regime state, and existing operational data.
3. It runs the RangeForge/operational decision process and persists the
   resulting evidence to PostgreSQL.
4. When the result is entry-ready, it persists an `execution.intents` record,
   an `execution.transaction_plans` record, and ordered transaction steps.
5. `lpforge-execution` uses an atomic PostgreSQL claim (`FOR UPDATE SKIP
   LOCKED`) to claim only one fresh mainnet `OPEN` plan at a time.
6. A plan is marked `DISPATCHING`, then either `SUBMITTED`, `FAILED`, or left
   for recovery handling. This prevents multiple execution workers from
   claiming the same plan.

There is no operator-approval environment variable, manual plan file, or
manual plan inbox in this path.

Relevant implementation:

- `apps/operator/src/main.ts`
- `packages/operational-runtime/src/index.ts`
- `packages/db/src/index.ts`
- `apps/execution/src/main.ts`
- `packages/phase6-live-worker/src/index.ts`

### 2. Public identity is available to the decision process, not the secret

The production service previously stripped the operator owner address from its
child decision process. That meant the strategy could assess a market but
could not create an executable plan.

This was changed in commit `3b4f58e`:

- The decision process receives `LPFORGE_OPERATOR_OWNER_ADDRESS`, which is a
  public wallet address only.
- The external/replacement position address remains stripped.
- `LIVE_SIGNING`, `LPFORGE_LIVE_EXECUTION`, and
  `LPFORGE_MAINNET_CANARY` are forced to `false` in the decision child.
- The production service has no signer import and no direct transaction-send
  path.
- The separate execution worker is the only process that loads the signing
  configuration.

This separation allows fully autonomous decisions without exposing private
key material to the data collection and strategy process.

### 3. Real paired-token entry lifecycle

Commit `7f81058` added the actual Jupiter/Meteora sequence required for a
paired-token LP entry:

1. RangeForge selects a supported strategy, orientation, bin range, and SOL
   capital.
2. Exact entry funding is calculated in raw units. A token-sided orientation
   is not generated.
3. If the chosen orientation requires paired-token funding, the planner adds a
   `JUPITER_SWAP` step before `METEORA_OPEN`.
4. Immediately before dispatch, the worker requests a fresh Jupiter Metis
   quote using the plan's exact SOL-to-token funding amount.
5. The quote is checked against configured slippage, price-impact, fee, and
   timeout policy.
6. The worker requests a fresh serialized Jupiter swap transaction, simulates
   it, checks its fee/cost budget, signs it, submits it once, and waits for
   confirmation.
7. Only after that swap is confirmed does the worker build the Meteora DLMM
   `OPEN` transaction.
8. SOL-only entry funding has no Jupiter step and proceeds directly to the
   Meteora build/simulate/sign/submit path.

The two actions are separately journaled so the database preserves which
stage was attempted and whether a submission requires recovery.

Relevant implementation:

- `packages/transaction-planner/src/index.ts`
- `packages/phase6-swap-quote/src/index.ts`
- `packages/phase6-autonomous-dispatch/src/index.ts`
- `packages/phase6-live-worker/src/index.ts`
- `packages/phase6-live-envelope/src/index.ts`

### 4. Real Meteora OPEN construction and signing

For an approved `METEORA_OPEN` step, the worker:

1. Loads the live Meteora DLMM pool through the configured RPC endpoint.
2. Creates a fresh in-memory `PositionV2` account signer for that one
   position. The private component is never logged or written to disk.
3. Builds the SDK transaction for the selected bins and calculated token/SOL
   funding.
4. Refreshes the recent blockhash and fee payer.
5. Simulates the transaction and persists simulation evidence.
6. Applies execution fee/cost limits and a short-lived per-action risk permit.
7. Signs with the owner signer plus the ephemeral position signer.
8. Uses the durable submission ledger to prevent a blind second send.
9. Polls for confirmation and attempts Meteora position reconciliation.

The owner signer is configured as `LOCAL_PRIVATE_KEY` in the ignored
`.env.execution` file. Its public key is checked against the configured
execution signer public key before any signature is produced. No report,
source file, PM2 command, or log emitted by this implementation contains the
private key.

### 5. Strategy coverage and inventory orientations

The live decision path is limited to the current RangeForge coverage:

| Strategy | Allowed orientations |
| --- | --- |
| `SPOT` | `BALANCED`, `SKEWED_Y`, `ONE_SIDED_Y` |
| `CURVE` | `BALANCED`, `SKEWED_Y`, `ONE_SIDED_Y` |
| `BID_ASK` | `BALANCED`, `SKEWED_Y`, `ONE_SIDED_Y` |

`X`/token-sided orientations are not generated or sent to execution. The
strategy chooses among the covered variants and may choose `NO_TRADE`; it is
not instructed manually to select a strategy or a range for each cycle.

### 6. Runtime configuration ownership

Configuration is deliberately separated by sensitivity:

| File | Purpose | Included in Git |
| --- | --- | --- |
| `.env` | Database URL, read RPC, public owner address, live-pool/read-only production settings, Telegram settings, and decision capital. | No |
| `.env.execution` | Write RPC, signer mode, signer public key, local private key/keypair path, and execution gates. | No |
| `policies/live-execution-policy.json` | Versioned pool allowlist and configurable capital/action/position constraints. | Yes |
| `policies/autonomous-entry-policy.json` | Jupiter quote provider and slippage/impact/fee/timeout policy. | Yes |
| `.env.example` / `.env.execution.example` | Sanitized configuration templates. | Yes |

The production decision process loads `.env` only. PM2 starts the execution
process with both `.env` and `.env.execution`. This keeps the local signing
secret out of the production decision daemon.

The configured decision capital has been set to `0.02` SOL. The current
versioned live-execution policy allowlists these public Meteora pools:

- `Cfc6zeThDv58QEQqNYN2jfTVKoLhrEevNXesPTQk5yGW`
- `CCHw81WFvz8SE4g9YSxRPs7ndZKhAsMsi2np2M2F6trW`

Each currently has `maxCapitalSol: "0.02"` and `maxOpenPositions: 1`.

## Important active policy constraints

The system is autonomous, but it is not unbounded. The following are active
configuration values in `policies/live-execution-policy.json` and are not
hard-coded source ceilings:

| Setting | Current value |
| --- | --- |
| Policy status | `ENABLED` |
| Maximum actions per day | `2` |
| Maximum open positions | `2` |
| Maximum capital per allowlisted pool | `0.02` SOL |
| Maximum open positions per pool | `1` |
| Per-action authority/risk TTL | 15 seconds |

Changing those values changes the policy, not application code. A change must
remain consistent with available wallet balance, configured execution-cost
limits, and the pool allowlist.

## PM2 deployment

The old PM2 processes that pointed to the prior soak checkout were replaced.
Both current services use this checkout as their working directory:

```
/root/systems/LPForge
```

Current commands configured by `ecosystem.config.cjs`:

```text
lpforge-production:
node --env-file=.env --enable-source-maps .build/apps/production/src/main.js start

lpforge-execution:
node --env-file=.env --env-file=.env.execution --enable-source-maps \
  .build/apps/execution/src/main.js start
```

The PM2 process list was saved after the handover. `lpforge-production` is
single-instance with autorestart. `lpforge-execution` is one independent
worker and starts only one plan-claim loop, preventing duplicate concurrent
dispatch.

Useful operational commands:

```bash
cd /root/systems/LPForge
pm2 status lpforge-production lpforge-execution
pm2 logs lpforge-production --lines 100
pm2 logs lpforge-execution --lines 100
node --env-file=.env --env-file=.env.execution \
  .build/apps/execution/src/main.js status
```

## Validation performed

The following succeeded after the autonomous changes:

```text
pnpm test:ci
```

Result:

- TypeScript typecheck: PASS
- Production build: PASS
- Test suite: PASS, 368 tests
- Phase 1 through Phase 7 static boundaries: PASS
- Migration lineage/static validation: PASS, M0001 through M0028

Additional live-read/runtime checks:

- PostgreSQL configuration and connection: PASS
- `lpforge-production` process: online from `/root/systems/LPForge`
- `lpforge-execution` launch assertion: PASS
- Execution signer configuration: ready, public identity matched by signer
  adapter
- Private write RPC authorization gate: PASS
- Autonomous PostgreSQL plan source: ready
- Recent production cycles: successful `NO_TRADE`; no invented entry plan
- Pending mainnet transaction plans: none
- Mainnet submission attempts: none

No live transaction, Devnet submission, mainnet submission, or signing test
was performed merely to produce this report. The execution worker is already
armed for the normal autonomous lifecycle and will act only after a fresh
strategy-approved plan is persisted.

## Current operational interpretation

`AWAITING_AUTONOMOUS_DECISION` is the expected normal state while the market
does not meet the entry criteria. It is not a missing configuration error and
it is not the previous manual-plan-inbox blocker. When a cycle becomes
`PLAN_PREPARED`, the worker claims the plan, refreshes quote/build/simulation
facts, then either submits a compliant transaction or records a durable block
reason without retrying blindly.

The Phase 7 process remains a separate read-only health, drift, incident, and
evidence control plane. Its current observe-only evidence state does not hold
the Phase 6 execution worker's PostgreSQL plan loop; the Phase 6 worker
enforces its own configuration, simulation, cost, signature, one-send, and
reconciliation controls.

## Source-change record

Recent commits that established this path:

| Commit | Change |
| --- | --- |
| `f9d6037` | Removed the Phase 6 manual launch/approval and inbox gating model. |
| `3079ee6` | Added autonomous Meteora OPEN preparation and ephemeral PositionV2 signing. |
| `90907b8` | Connected the autonomous execution worker to PostgreSQL plan claims. |
| `7f81058` | Added fresh Jupiter funding-swap build, simulation, signing, submission, and confirmation before Meteora OPEN. |
| `3b4f58e` | Allowed the read-only decision child to retain only the public owner address and create autonomous plans. |

## Operational cautions

- A paired-token entry contains two distinct on-chain actions: the Jupiter
  funding swap and the Meteora LP open. If the swap succeeds but the LP open
  is blocked by a later simulation or cost check, the paired token remains in
  the wallet and the plan records the failure. It is not silently retried as a
  second swap.
- The environment files are owner-only and ignored. Do not add them to Git,
  archives, chat messages, or support tickets.
- The live policy controls real capital. Adjust policy values deliberately in
  the versioned policy file, then review/restart the worker as appropriate.
- The host filesystem was observed at roughly 94.6% utilization during the
  handover. This does not block the current processes, but it should be
  monitored before retaining large logs or adding build artifacts.

## Addendum: two-pool production universe (2026-08-13)

Production now evaluates both configured execution pools every cycle through
the comma-separated `LPFORGE_PRODUCTION_POOL_ADDRESSES` setting. The primary
health/drift pool is the first address in that universe. This replaced the
unrelated former smoke pool for production decision-making.

The first verified cycles for both pools are `WARMING` / `NOT_REACHED`, which
is expected while each pool accumulates the required independent historical
observations. No execution plan was created and no transaction was sent.

The execution worker was deliberately stopped during this deployment and
remains stopped. Before it is re-armed, it needs the independent enforcement
patch identified above: validate plan provenance and validate the plan's
pool/capital/position facts against the execution policy at claim time.

## Lifecycle completion update (2026-08-13T12:55:28Z)

This update completes the implementation work that was previously listed as
remaining in the live lifecycle handoff. It does not start the execution
worker or send a transaction.

### Owned-position production loop

`lpforge-production` now loads the persisted LPForge-owned PositionV2 records
for its public owner, reads each position and its pool's active bin from
Meteora, and stores a `position_observations` record every cycle. The new
versioned policy file `policies/live-position-management-policy.json` governs
management behavior. It currently:

- claims accrued fees for an in-range owned position;
- creates a deduplicated `RESHAPE` plan when an owned position is out of
  range, preserving its current strategy and width while re-centering on the
  active bin; and
- holds rather than guessing when chain position truth is missing.

Production has no signer capability. It writes only PostgreSQL evidence and
transaction plans. The execution worker remains the only process that can
load the local owner signer.

### Ordered reshape/rebalance lifecycle

The execution worker now processes `RESHAPE` and `REBALANCE` as an enforced
ordered lifecycle:

1. Build, simulate, sign, submit, and confirm a full old-position removal.
2. Read the old PositionV2 on-chain; it must be absent before proceeding.
3. Refresh native and pool-token wallet facts.
4. Mark the old LPForge owned-position record closed and persist the
   reconciliation evidence.
5. Generate a fresh in-memory replacement PositionV2 signer, rebuild the
   Meteora open transaction from the reconciled removed liquidity, and then
   follow the normal simulation/risk/sign/submit/reconcile path.

The read-only producer never creates a replacement keypair. The executor
creates it only after removal reconciliation and keeps its private component
in memory for that transaction only.

### Chain-aware recovery

Execution now creates a durable journal before a plan is worked and records
the submitted signature when one exists. Recovery obtains RPC signature
status and Meteora position truth before it changes a pending plan. It keeps
valid unknown submissions in a no-resend state, permits a rebuild only after
expiry plus proven absence, and records reconciliation evidence when an
economic effect is proven. A reshape/rebalance with only the old-position
effect proven remains in reconciliation rather than being falsely completed.

### Validation and current state

`pnpm test:ci` passed after this update:

- TypeScript typecheck and build: PASS
- Test suite: PASS, 378 tests
- Phase 1–7 boundary checks: PASS
- Migration static validation: PASS, M0001–M0029
- `git diff --check`: PASS

Additional tests cover policy decisions for owned positions, duplicate journal
ownership/version conflicts, no-resend recovery behavior, and the required
remove → reconcile → wallet-refresh → replacement-open ordering.

Current PM2 state at update time: `lpforge-production` is online and
`lpforge-execution` is stopped. No transaction was signed or sent while
implementing or validating this lifecycle update.

### Execution-start recovery correction

Before the execution worker was re-armed, its standalone recovery command was
found to close its PostgreSQL client before the asynchronous recovery scan had
finished. The command now awaits the scan before closing the client. A live
`recover-once` check completed with an empty recovery queue, followed by a
full passing `pnpm test:ci` run (378 tests and all Phase 1–7 boundaries).
