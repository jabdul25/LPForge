# LPForge partial-entry canonical funding authority fix

## Scope

Narrow P6/P7 continuation-control correction only.  No entry, range, capital,
signing, submission, retry, protection, settlement, or accounting policy was
changed.

## Observed production incident

`plan-cd597a6ea3bb3c1ee7dad5aaca724553` funded successfully at
2026-09-13T09:48:17.109Z.  Its funding child has a canonical
`execution.confirmations` row with `CONFIRMED` status.  The parent
`execution.execution_journal` later represented its `METEORA_OPEN` child and
was no longer `CONFIRMED`, so P7 incorrectly emitted
`P7_FUNDED_OPEN_FUNDING_NOT_CONFIRMED`.  It also treated the plan's own
provisional partial-entry row as unrelated recovery debt.

The LP-open child was simulation-valid and submitted, but its exact signature
did not appear on chain during its bounded confirmation window.  P6 did not
create a replacement open or repeat funding; it reconciled and used the exact
unwind path.  That fail-closed outcome remains unchanged.

## Correction

P7 recovery facts and terminal recovery display now identify a confirmed
funding child by the immutable tuple:

- `partial_entry_recovery.funding_transaction_id`
- exact funding signature
- `submission_attempts`
- a successful `confirmations` row (`CONFIRMED` or `FINALIZED`, no error)

This replaces the mutable parent-journal inference only for the provisional
funded-open family.  A canonically confirmed, unexpired same-plan funding child
is no longer counted as generic partial-entry recovery debt.  Separate recovery
debt, unknown submissions, reconciliation debt, and a second funded plan still
deny continuation.

An already-submitted LP-open child with unresolved exact chain truth also denies
continuation.  Its original signature must become terminally confirmed, failed,
or expired before P6 can take any next recovery action; P6 never constructs a
replacement LP-open while that first child is unresolved.

## Safety invariants retained

- P7 still blocks all unrelated new entries while any funded continuation is
  unresolved.
- P6 may continue only the exact identity-bound plan.
- A funding transaction is never repeated.
- An open child with unknown chain truth is never resent as a replacement.
- The existing bounded reconciliation and exact unwind path remains the only
  outcome if the open cannot be proven.

## Validation

- TypeScript build: pass.
- Focused funded-open continuation tests: 8/8 pass.
- Production read-only evidence verified the incident's canonical funding
  confirmation while its parent journal was no longer `CONFIRMED`.
