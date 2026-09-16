# LPForge Terminal Position Timestamp Visibility V1

## Scope

Terminal UI only. No lifecycle, database, settlement, return-calculation,
exit-reason, policy, trading, or execution behavior changes were made.

## Timestamp visibility

`FILLS / RECENT POSITIONS` now displays a `LIFECYCLE TIME` column using the
existing `TerminalRecentPosition.observedAt` field without altering its source:

- OPEN/LIVE rows render `OPEN HH:MM` from the existing lifecycle entry time.
- CLOSED rows render `CLOSED Mon DD HH:MM` from the existing canonical final
  settlement time.

Times are formatted in UTC, consistent with the terminal header. Invalid or
unavailable persisted timestamps render an explicit `OPEN TIME N/A` or
`CLOSED TIME N/A`; no timestamp is inferred.

The same existing timestamp is visible in the compact/mobile history renderer.
Existing LIVE/CLOSED status indicators, ordering (live before closed), filters,
return authority labels, and recorded exit/protection reasons are unchanged.

## Files changed

- `apps/terminal/src/model.ts` — presentation-only timestamp formatting in
  standard and compact recent-position rows.
- `tests/decision-terminal-shell.test.mjs` — validates OPEN and CLOSED
  timestamp labels alongside existing mixed-lifecycle visibility assertions.

## Validation

- Typecheck: pass
- Focused terminal shell suite: 26/26 pass
- Full CI: pass
- Whitespace/diff validation: pass

## Deployment verification

The normal immutable release activation verifies GitHub source identity,
release-manifest source identity, runtime release identity, canonical policy
hash, PM2 service CWDs, and rendered terminal output. This UI release must
leave the approved live-execution policy byte-for-byte unchanged.
