# LPForge

LPForge is a safety-first Meteora DLMM liquidity-position system for Solana. It separates market research from execution and treats a live position as a complete lifecycle: authorize, construct, submit, confirm, discover, reconcile, monitor, manage, settle, and close.

The repository contains the current source, migrations, tests, policies, and deployment tooling. It does **not** contain production secrets, wallets, database state, execution journals, or built release artifacts.

## What LPForge does

- Discovers and evaluates Meteora DLMM pools and candidate ranges.
- Uses the P3 recommendation path, Phase 4 timing controls, and P7 production safety controls before any risk-increasing action.
- Runs wallet-wide position discovery, chain/DB reconciliation, durable execution journals, confirmation recovery, and idempotency controls.
- Monitors owned positions and supports protective `REMOVE`, `CLOSE`, and `EMERGENCY_CLOSE` actions after entry authority has been withdrawn.
- Records V3 Legacy and Canonical economics prospectively as research evidence; research output does not by itself authorize live execution.
- Includes M0060 protections for multi-chunk opens: every economic chunk must have an authoritative disposition, partial entries retain wallet-inventory attribution, and live management values complete canary NAV rather than PositionV2 alone.

## Safety model

LPForge is default-deny. A valid live entry requires all applicable controls to agree:

1. a mechanically constructible P3 recommendation;
2. a fresh executable Phase 4 timing result;
3. eligible P7 health, release integrity, portfolio, and reconciliation facts;
4. an explicitly scoped execution authorization and plan binding;
5. a healthy private-key signer and authenticated execution RPC; and
6. configured capital, position-count, and idempotency limits.

`WATCH` telemetry is not hidden. A genuine `CRITICAL`, stale evidence, release mismatch, reconciliation failure, unknown economic submission, or conflicting position blocks new risk. Entry authority is distinct from protective authority: a previously opened owned position remains eligible for monitoring, reconciliation, and protective closure even when new entry is blocked.

The checked-in policy files are under [`policies/`](policies/). Their JSON contracts are runtime inputs; do not edit them casually on a live host.

## Repository layout

```text
apps/        Service entry points: production, execution, discovery, learning
packages/    Domain, economics, execution, reconciliation, and P7 modules
policies/    Versioned runtime policy contracts
packages/db/migrations/
              PostgreSQL migrations, currently through M0060
scripts/     Build, PM2, release-identity, and boundary verification scripts
tests/       Unit, integration-style, lifecycle, and safety regressions
```

Important current database contracts include:

- `M0056_reset3c_decision_relevant_validation.sql` for prospective V3 validation retention and maturation;
- `M0058_wallet_position_reconciliation.sql` for wallet-wide position reconciliation;
- `M0059_execution_journal_state_contract.sql` for durable execution-journal states; and
- `M0060_open_chunk_disposition.sql` for authoritative multi-chunk open disposition, partial-entry protection, inventory attribution, and complete managed NAV.

## Source checkout versus production release

The Git checkout is deliberately different from a running release:

```text
GitHub source checkout
        -> install, test, build, and validate migrations
        -> create immutable LPForge-release-<source-sha>
        -> PM2 runs services from that release directory
```

Release directories, `.build/`, `dist/`, dependency directories, logs, databases, position state, and secrets are intentionally excluded from Git. A release manifest, checksums, and source revision must be generated and verified for the exact release artifact; do not copy an old release directory as a generic deployment.

Production runtime configuration is mounted at `/root/systems/LPForge`: `.env`
for non-secret settings, `.env.execution` for protected execution settings,
and `policy/live-execution-policy.json` for the canonical execution policy.
Immutable `LPForge-release-<sha>` directories never own runtime environment
files. See [the centralized runtime configuration runbook](docs/runbooks/RUNBOOK_CENTRALIZED_RUNTIME_CONFIGURATION.md).

## Development and validation

Requirements: Node.js 24, Corepack/pnpm, and PostgreSQL for database-backed checks.

```bash
git clone git@github.com:jabdul25/LPForge.git
cd LPForge
corepack enable
pnpm install --frozen-lockfile
pnpm test:ci
pnpm build
```

`pnpm test:ci` runs TypeScript checks, the test suite, Phase 1-7 boundaries, discovery and forward-validation boundaries, telemetry boundaries, and static migration verification.

Useful targeted checks include:

```bash
pnpm typecheck
pnpm verify:migrations
pnpm verify:phase5
pnpm verify:phase6
pnpm verify:phase7
pnpm verify:postgres:reset3c-v3
```

## Production deployment

Do not start a clone as a live trading system.

1. Provision database, authenticated RPC, and signer configuration directly on the target VPS using the safe templates (`.env.example`, `.env.execution.example`, and `.env.production.example`). Never commit or transmit secret values through Git.
2. Build and validate the exact source revision, including migrations through M0060.
3. Create and verify a new immutable release artifact with its own manifest, checksum set, and source revision.
4. Apply migrations through the normal deployment migration runner.
5. Start services through the supplied PM2/start scripts in a safe reconcile-only or equivalent mode first.
6. Verify signer identity, RPC health, wallet reconciliation, P7 health, and policy limits before any explicit, bounded live authorization.

The usual service entry points are:

- `apps/production` — P7 control-plane and production safety facts;
- `apps/execution` — execution journals, signing/submission gates, recovery, reconciliation, and protective management;
- `apps/discovery` — pool and market discovery; and
- `apps/discovery-learning` — prospective V3 evidence collection and maturation.

PM2 helper scripts are available in [`scripts/`](scripts/). They are deployment tools, not authorization to enable live signing or submission.

## Secrets and operational state

Never commit:

- `.env`, `.env.execution`, or environment-specific local files;
- private keys, seed phrases, signer exports, API/RPC credentials, or database passwords;
- execution journals, transaction exports, wallet balances, database dumps, or PM2 logs.

Use the tracked templates only as variable-name references. The repository intentionally contains no production credentials.

## Contributing

Keep source, migrations, tests, policy contracts, and safe documentation in Git. Keep generated releases and runtime state outside Git. Any execution, reconciliation, or policy change must preserve default-deny behavior and pass the relevant lifecycle and boundary tests before deployment.
