# LPForge State A Configurable Deterioration Protection — Implementation V1

## Historical motivation

Historical validation identified a positive-but-unarmed deterioration shape:
a durable positive Meteora-compatible live-control peak, at least 50% loss of
that peak, and a return at or below breakeven.  State A is additive.  It does
not replace the legacy profit-protection, TS-5, OOR-P4, hard-stop, emergency
stop, reconciliation, or settlement controls.

## Canonical policy

The only State A value authority is
`release-policy-templates/live-execution-policy.json`, promoted on activation
to `/root/systems/LPForge/policy/live-execution-policy.json` and bound to the
immutable release manifest hash.

```json
"stateADeteriorationProtection": {
  "enabled": true,
  "action": "CLOSE",
  "minimumPeakReturnFraction": 0,
  "givebackFraction": 0.5,
  "minimumReturnThresholdFraction": 0,
  "cooldownSeconds": 0,
  "maximumObservationAgeSeconds": 300
}
```

Fractions are decimal fractions: `0.5` is a 50% giveback of the durable peak.
`minimumPeakReturnFraction: 0` still requires a strictly positive live-control
peak.  `cooldownSeconds: 0` deliberately does not suppress a protective close;
the existing active-plan and position-scoped protected-close lock provide
duplicate prevention. `maximumObservationAgeSeconds` is the explicit
same-cycle chain/pool freshness bound; stale context cannot trigger State A.

## Detection and safety contract

State A requires all of the following:

- an open lifecycle;
- fresh, available Meteora Position PnL API live-control valuation;
- a durable, confirmed positive live-control high-water mark;
- current live-control return at or below the configured breakeven threshold;
- giveback at or above the configured fraction of the peak;
- fresh chain/pool context;
- clean reconciliation; and
- no active management or close plan for the position.

Missing valuation, stale facts, reconciliation debt, terminal lifecycle state,
or an active plan produces a hold/no-detection result.  A qualifying State A
result requests `CLOSE` with reason `EXIT_STATE_A_DETERIORATION`; it is not
silently converted to an emergency-close rule.  Existing higher-priority
emergency, hard-stop, market, and legacy-profit exits retain their authority.

## Audit and telemetry

The existing `execution.position_exit_state.payload` JSONB audit projection
receives these exact bounded fields when State A is detected:

- `state_a_detected_at`
- `state_a_peak_return`
- `state_a_current_return`
- `state_a_giveback`
- `state_a_action`

It also retains active bin, range position, and inventory state in
`state_a_context`.  The immutable protective plan metadata carries the same
State A assessment.  A deduplicated Telegram alert,
`STATE_A_DETERIORATION_DETECTED`, reports pool, peak, current return,
giveback, action, active bin, range state, and inventory state.

No database schema migration is required: the established durable exit-state
payload and protected close-plan transaction are used without overwriting the
existing exit-reason fields.

## Validation

Focused validation passed for:

- qualifying durable positive peak / 50% giveback / breakeven-loss detection;
- no positive peak and insufficient giveback rejection;
- stale or unavailable live-control valuation rejection;
- reconciliation-debt rejection;
- active-plan duplicate prevention;
- disabled-policy behavior;
- cooldown behavior;
- canonical-policy parsing and malformed-policy rejection; and
- operator wiring to audit, alert, and serialized protective-close handling.

`pnpm test:ci` passed from the implementation worktree before release build.

## Non-changes

This implementation does not modify range construction (MIN60/MAX100),
capital sizing (0.03 SOL), max positions, entry economics, P3/P4, P6 signing,
hard/emergency stops, legacy profit protection, TS-5, OOR-P4, settlement, or
reconciliation rules.
