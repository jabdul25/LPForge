# LPForge Terminal Position Status Visibility Improvement V1

## Scope

Terminal display only. This change consumes the existing terminal lifecycle
projection; it does not change lifecycle, position accounting, exit reasons,
settlement, execution, State A, policy, or trading behavior.

## UI change

`FILLS / RECENT POSITIONS` now renders an explicit `STATUS` field from the
existing `TerminalRecentPosition.state` value:

- `● LIVE` for the existing `OPEN` lifecycle projection;
- `✓ CLOSED` for the existing canonical settled lifecycle projection.

The existing pure ordering helper continues to put all open rows before closed
history, with newest-first ordering inside each state. The renderer makes the
valuation authority explicit without changing any value:

- an open row shows `LIVE <return>` from its existing live-control mark;
- a closed row shows `REALIZED <return>` from its existing canonical settlement
  result.

The compact shell table preserves the existing range, return, live peak, peak
gap, and path/reason information while adding the status column. Existing
`ALL`, `LIVE`, and `CLOSED` terminal filter behavior remains intact.

## Files changed

- `apps/terminal/src/model.ts` — presentation-only status indicator and
  live-versus-realized return label in the fills renderer.
- `tests/decision-terminal-shell.test.mjs` — mixed OPEN/CLOSED visibility,
  order, and valuation-label assertions.

## Policy and data safety

The approved State A live-execution policy template was verified unchanged:

`a07387ef6d4c0be479f16278ccef27f91647b32daed45d7191181ac089257454`.

No database queries, lifecycle mappings, return calculations, exit reasons, or
position-control code were modified.

## Validation

- Typecheck: pass
- Terminal shell test suite: 26/26 pass
- Terminal width/phone-layout tests: pass
- Diff whitespace check: pass

## Deployment verification

Release activation verifies GitHub, release manifest, runtime identity, policy
hash, PM2 CWD, and the live terminal output after installation. The target
runtime policy remains the approved State A configuration; no policy values
are changed by this UI release.
