# LPForge State A Persistence Confirmation V1

## Scope and provenance

- Starting source SHA: `79d7b63763342d642aa2b9fad07f0a264e4ab89d`
- Change scope: State A deterioration protection only.
- Database migration: none. The implementation reuses the existing durable `execution.position_exit_state.payload` record.
- New canonical policy field: `stateADeteriorationProtection.confirmationSeconds: 30`.
- Existing State A thresholds are unchanged: `minimumPeakReturnFraction: 0`, `givebackFraction: 0.5`, `minimumReturnThresholdFraction: 0`, `cooldownSeconds: 0`, and `maximumObservationAgeSeconds: 300`.

## Previous behavior and root issue

Previously a fresh qualifying State A observation immediately produced `EXIT_STATE_A_DETERIORATION` and the ordinary State A close path. `cooldownSeconds` only suppressed later detections; it was not an observation window.

EMBER demonstrated the false-positive risk: State A detected at `2026-09-16T15:15:36.692Z` at approximately `-0.11%` after a `+0.62%` peak, but a retained fresh mark approximately 11 seconds later was `+0.03%`. The position remained in range. The later market path is not treated as decision-time knowledge; the relevant regression fact is that the initial State A condition did not persist.

## Implemented state machine

```
fresh qualifying State A observation
  -> STATE_A_PENDING_STARTED
  -> persist per-position due time (first detected + confirmationSeconds)

fresh non-qualifying observation before confirmation
  -> STATE_A_PENDING_CANCELLED / RECOVERED
  -> clear pending state; no State A close

fresh qualifying observation at or after due time
  -> STATE_A_DETERIORATION_CONFIRMED
  -> existing EXIT_STATE_A_DETERIORATION close path
```

`confirmationSeconds: 0` intentionally preserves the former immediate State A close behavior.

## Durable state and restart semantics

Pending confirmation is stored in the existing position-specific exit-state payload under `state_a_pending`, with `schemaVersion`, `firstDetectedAt`, `confirmationDueAt`, peak/current return, giveback, position ID, and position address. It is not process memory and not a global timer.

After a restart, the operator loads this pending state, obtains a fresh canonical observation, and uses the original due time. It does not restart the timer and it does not close solely because a pending record exists. If the current observation is stale or unavailable, State A remains unconfirmed and no State A close is created.

Pending state is cleared on recovery, State A confirmation, terminal state, active management/close-plan state, or any independent close selected in the same control cycle.

## Close precedence and cooldown

State A only delays its own `EXIT_STATE_A_DETERIORATION` action. Existing hard stop, emergency stop, legacy profit protection, TS-5, OOR-P4, recovery, and Telegram emergency-close decisions continue to act without waiting for State A confirmation. A pending State A record is superseded and cleared if another close is selected.

Cooldown remains separate from confirmation. It begins only after a confirmed State A event. A recovered/cancelled pending observation does not create cooldown and a later deterioration begins a new full confirmation window.

## Telemetry

The implementation records `state_a_status` and pending state in durable exit-state payload. It emits:

- `STATE_A_PENDING_STARTED`
- `STATE_A_PENDING_CANCELLED`
- `STATE_A_DETERIORATION_CONFIRMED`

The final close reason remains `EXIT_STATE_A_DETERIORATION` for downstream compatibility. Alert delivery remains observational and cannot determine trading authority.

## EMBER regression demonstration

With `confirmationSeconds: 30`:

- `15:15:36.692Z`: qualifying observation creates pending State A, due approximately `15:16:06.692Z`.
- approximately 11 seconds later: fresh mark is positive and no longer qualifies.
- Result: pending State A is cancelled and State A does not request a close.

## Validation

Focused tests cover first detection, fast recovery, recovery at 29 seconds, persistent confirmation at 30 seconds, restart before/after due time, stale-evidence failure, zero-second legacy compatibility, separate pending state for two positions, duplicate-plan suppression, stronger hard/emergency close precedence, cleanup, and policy validation.

- Focused State A tests: 42/42 passed.
- Typecheck: passed.
- Full CI: run before release build; the immutable release builder reruns the full suite as release validation.

## Unchanged controls

No change was made to profit protection, TS-5, OOR-P4, capital policy, maximum positions, entry policy, range policy, execution mechanics, reconciliation, settlement, or State A thresholds. The only intended trading-policy change is the 30-second persistence requirement for State A's own close.
