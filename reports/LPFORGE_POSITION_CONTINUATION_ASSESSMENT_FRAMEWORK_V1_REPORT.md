# LPForge Position Continuation Assessment Framework V1

## Scope

Starting source: `28c317fdce94dc05a35e682b14135ce19dfebfc4`.

PCA V1 is an **observe-only** lifecycle checkpoint. It creates no close plan,
transaction, swap, submission, range change, capital change, or P7 authority
change. Existing State A, profit protection, hard-stop, OOR, entry, capital,
and settlement behavior remain independent and unchanged.

## Problem

P3's entry forecast is a 60-minute contract, whereas positions have
historically remained open materially longer. PCA records a structured review
at that forecast horizon instead of silently treating the entry thesis as
unbounded.

## Policy

The sole production policy authority is `live-execution-policy.json`.

```json
"positionContinuationAssessment": {
  "enabled": true,
  "firstAssessmentMinutes": 60
}
```

Both fields are mandatory, schema-validated, and fail closed when absent or
invalid. `firstAssessmentMinutes` is an integer from 1 through 1,440. There is
no production fallback horizon.

During release preparation, the template was also reconciled to the already
active production policy: State A remains disabled and live-control loss
protection remains at -7% for 60 seconds. Those are preservation changes, not
PCA policy changes.

## Assessment model

At the first eligible checkpoint, PCA loads the immutable lifecycle-linked P3
recommendation and thesis context, then captures:

- entry reason, forecast horizon, expected economics, confidence, and
  uncertainty;
- fresh live-control and managed economics, NAV, fee contribution, and
  inventory shares;
- range state, current/entry/boundary bins, boundary distances, and OOR state;
- existing market regime, flow quality, and toxicity evidence; and
- observable deterioration diagnostics such as negative live control, OOR,
  inventory stress, non-positive continuation EV, regime deterioration, and
  fee/inventory imbalance.

It records either `CONTINUATION_APPROVED` or `CONTINUATION_DEGRADED`; these are
assessment labels only. They carry no action field and have no execution path.

## Durability and telemetry

The assessment first persists `POSITION_CONTINUATION_PENDING` and then stores
the completed structured assessment in the existing per-position
`execution.position_exit_state.payload`. This is per position, restart-safe,
and requires no schema migration or global timer.

Telemetry events:

- `POSITION_CONTINUATION_ASSESSMENT_STARTED`
- `POSITION_CONTINUATION_ASSESSMENT_COMPLETED`
- `POSITION_CONTINUATION_DEGRADED` (only for a degraded result)

Telegram notifications are informational/observational and cannot affect
assessment or trading authority.

## Validation

- PCA unit and policy behavior: 7/7 passed.
- Focused PCA, State A, loss-protection, exit-governor, and lifecycle suite:
  71/71 passed.
- Configuration/reporting/policy suite: 36/36 passed.
- Typecheck: passed.
- Build: passed.
- Full CI, including lifecycle, reconciliation, settlement, and boundary
  verification: passed.

## Production invariants

- Automatic close: **none**.
- Close plans, swaps, submissions, and execution side effects: **none**.
- State A, profit protection, hard stop, OOR, entry policy, capital policy, and
  max-position policy: **unchanged**.
- Database migration: **none**; PCA uses existing durable position-exit state
  payload storage.

Final production release SHA and activation alignment are recorded after the
immutable build and deployment verification.
