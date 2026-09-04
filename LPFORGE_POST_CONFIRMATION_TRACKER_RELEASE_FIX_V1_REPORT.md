# LPFORGE Post-Confirmation Tracker Release Fix V1

## Root cause

`recordPostEvidenceEvaluationOutcome` treated evidence-maturity `NO_TRADE` as
another continuity-tracking condition. Consequently, a durably confirmed live
episode remained `TRACKING` after terminal downstream evaluation and occupied a
bounded continuity slot. Waiting records also retained active-episode fields
from prior tracker state.

## Correction

- A tracker is released as `COMPLETED` when durable live confirmation is
  observed, independently of P3/P4 economic handling.
- Terminal P3 handoff clears active episode fields and preserves the separate
  confirmed maturity record and raw collector history.
- Waiting-slot and re-admitted records clear active anchor, last-observation,
  deadline, tracker-start, and tracker-expiry fields.
- Qualified continuity observations now persist the current last observation
  and the matching `lastObservationAt + 450s` diagnostic deadline.

## Validation

Focused continuity tests: 40/40 passing.

Canonical CI: 984/984 passing, including all configured boundary and migration
checks. No evidence thresholds, tracker cap, RPC concurrency, range policy,
P3/P4 policy, or execution paths were changed.
