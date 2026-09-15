# LPForge Decision Terminal Operator Intelligence UI Upgrade V1

## Scope and safety

This release changes the read-only shell terminal only.  It does not write to
the database, change trading policy, create transactions, or alter P3, P4,
P6, P7, range construction, capital, exits, settlement, or reconciliation.

## Operator view

The upgraded terminal renders:

- a production/status/safety/entry status bar with live position, watch-pool,
  candidate, and last-action counts;
- a deterministic Decision Pipeline and Current Blocker view, with both
  human-readable reason text and the durable raw reason code;
- Candidate Pipeline counts and top blocker ranking;
- Economic Engine facts from the existing P4 candidate row;
- Range Monitor facts from the bounded recent closed-position cohort, including
  active min/max policy, inclusive range widths, and observed range-path loss
  classes;
- Position Health for the latest ten closed lifecycles and a UTC-day canonical
  settlement aggregate;
- an upgraded fills/recent-positions table.  Live rows remain sorted above
  settled rows.  It adds entry range, maximum retained profit mark, giveback,
  loss class, and recorded protection where evidence exists;
- event filters: `ALL`, `DECISIONS`, `TRADES`, `PROTECTIONS`, `RISK`, and
  `ERRORS`; and
- the existing P7/RPC/recovery/release health facts in a clearer panel.

## Data authority and performance

All values are existing durable facts.  Open PnL remains receipt-backed
live-control PnL, deliberately separate from managed economics.  Closed PnL
uses canonical lifecycle settlement.  Range-path labels use the existing
position-observation history and are presentation-only.

Refresh remains on the existing terminal cadence.  Queries are bounded: the
current candidate cycle, active watch rows, active positions, 100 event rows,
20 recent canonical settlements, and one UTC-day aggregate.  No new workers,
tables, indexes, or writes were introduced.

## Files changed

- `apps/terminal/src/main.ts` — read-only snapshot enrichment and bounded
  UTC-day performance aggregate.
- `apps/terminal/src/model.ts` — terminal layout, deterministic explanation
  renderer, event filters, operator analytics, and fills presentation.
- `tests/decision-terminal-shell.test.mjs` — operator panel, configuration,
  filtering, mobile layout, and read-only regression coverage.

## Verification

- Typecheck: pass
- Build: pass
- Focused terminal tests: 22/22 pass

The terminal remains a TTY-native observability surface.  It has no browser,
HTTP route, signer, transaction submission, or policy authority.
