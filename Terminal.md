# LPForge Decision Terminal — Shell TUI Plan and Contract

**Selected interface:** interactive SSH shell terminal, not a browser application.
**Authority:** read-only observability.
**Refresh:** one bounded canonical snapshot every two seconds.
**Command after release installation:** `lpforge-terminal` (or the immutable release's `scripts/start-lpforge-service.sh terminal`).

## Why this is lightweight

The terminal uses Node's built-in ANSI escape sequences and the existing `pg` dependency. It introduces no web server, browser bundle, framework, charting library, polling daemon, PM2 process, tunnel, domain, or reverse proxy.

Expected steady production impact is zero while it is not open. During an operator session it owns one small read-only PostgreSQL pool (maximum two connections), runs bounded reads once per two seconds, and normally stays well below 100 MB RSS. It never calls Solana RPC, Meteora APIs, a signer, P6, or P7.

## Implemented screen

The TUI renders, in an ANSI/Unicode terminal:

1. LPForge Decision Terminal header with UTC clock, release and mounted policy provenance.
2. Live Event Stream from bounded canonical alert-outbox evidence.
3. Decision Terminal for the latest canonical production candidate cycle.
4. Candidate Pipeline using exact operational states from that current cycle.
5. Active Pools using current canonical owned-position, range, managed-return/MFE, OOR, and exact TS-5/OOR-P4 evidence.
6. Agent / Engine Desk using honest persisted evidence/freshness rather than invented process-health percentages.
7. Fills / Recent Positions, distinguishing `MARK` on open positions from canonical realized settlement returns on closed positions.
8. System Health for P7, P6 recovery/UNKNOWN facts, plans, incidents, and Telegram outbox evidence.

It intentionally does **not** include a portfolio/equity dashboard, charts, price ticker, order book, wallet widget, manual position action, policy edit, recovery override, or Telegram control.

## Data contract

The terminal reads only canonical persisted sources:

- current global candidate cycle: `execution.production_global_selection_cycles` and `execution.production_global_candidates`;
- active positions: `execution.owned_positions`, latest `execution.position_observations`, `execution.position_exit_state`, and `execution.position_oor_lifecycle_state`;
- settled positions: newest `execution.lifecycle_sol_settlements.settlement_version` only per lifecycle, plus canonical realized-economics/management-summary joins;
- event evidence: bounded newest-first `execution.phase7_telegram_alert_outbox`;
- P7 state/incidents: `operations.phase7_control_decisions` and `operations.phase7_incident_states`;
- P6/recovery state: canonical execution journals, plans, partial-entry recovery, and submission evidence.

`TS5 WATCH`, `TS5 CONFIRMED`, and `OOR-P4 CONFIRMED` are shown only from persisted exit-state assessment/reason evidence. They are never inferred from a generic drawdown or OOR state.

## Interaction

The terminal has no economic controls. Its keys are local display controls only:

- `q` / `Ctrl-C`: quit;
- left/right arrow or `h`/`l`: previous/next current candidate;
- `e`: cycle the already loaded event filter (`ALL`, `POOLS`, `ENGINES`, `EXECUTION`);
- `f`: cycle fills (`ALL`, `OPEN`, `CLOSED`);
- `r`: request an immediate new snapshot.

## Safety contract

- The launcher removes signer and live-execution environment variables before starting the terminal.
- `loadPhase1Config()` rejects live signing or signer material.
- The terminal has no transaction builder, signer, sender, policy writer, plan writer, recovery writer, HTTP listener, or browser route.
- Snapshot failure only redraws an operator message and retries. It cannot stop or alter P6, P7, entries, closes, TS-5, OOR-P4, recovery, accounting, or settlement.
- No credential, full wallet address, database URL, RPC URL, Telegram secret, or environment dump is rendered.

## Validation plan

1. Typecheck and build the complete repository.
2. Run focused shell-terminal tests covering all seven regions, exact local filters, candidate navigation, open-mark/closed-realized distinction, and absence of browser/economic controls.
3. Run the built command against production using `--once --plain`; validate real schema data, no secret output, and query timing.
4. Run complete CI and release integrity validation.
5. Install the immutable terminal release without restarting P6, P7, discovery, execution, or Telegram services; this is an on-demand command, not a daemon.
6. Publish the stable `lpforge-terminal` shell wrapper to the immutable terminal release and verify it produces a current read-only snapshot.

## Explicitly out of scope

- Browser UI, `/terminal` HTTP route, web authentication, Cloudflare/tunnel changes, or PM2 terminal service.
- Any trading/recovery/accounting policy or code path modification.
- New database schema, migration, index, cache, or write-model.
