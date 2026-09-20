# LPForge Live-Control Negative Return Persistent Capital Protection V1

## Scope

This release adds one policy-driven, durable protective-close layer. It does not alter entry selection, range construction, capital sizing, State A, profit protection, OOR handling, or the existing -12% hard stop.

## Starting point and motivation

Starting source SHA: `7ed0bc8e113c62e273f63d1ce6c92fcb81f34576`.

Historical review found that large inventory-led losses can deteriorate while still in range, and that the existing -12% hard stop can be the first containment action. On the retained telemetry-complete cohort (77 positions, 39 winners and 17 large losses), the researched predicate of fresh live-control return at or below -8% for 60 seconds captured 13 of 17 large losses and no historical winner observations. Historical evidence remains descriptive rather than a promise of executable savings.

## Policy

The canonical live-execution policy adds:

```json
"liveControlLossProtection": {
  "enabled": true,
  "thresholdReturnFraction": -0.08,
  "confirmationSeconds": 60
}
```

The deployment-policy parser fails closed if this section is absent or invalid. Execution has no fallback threshold, duration, or enablement value.

## State machine

1. A fresh, Meteora-compatible live-control return at or below the policy threshold starts `LIVE_CONTROL_LOSS_PENDING` for that position.
2. The pending state is persisted in the canonical position exit-state payload with detection time, due time, threshold, current return, and evidence timestamp.
3. A fresh observation above the threshold immediately cancels it without a cooldown.
4. A fresh qualifying observation at or after the due time creates the normal canonical protective close with reason `EXIT_LIVE_CONTROL_LOSS_PROTECTION`.
5. Missing or stale evidence never confirms a close.

Pending state is per position, survives process restart, preserves the original due time, and is removed on recovery, confirmation, superseding close, or terminal lifecycle completion.

## Priority and execution safety

This layer does not wait for or delay independent existing actions. Emergency close, hard stop, reconciliation/recovery protections, settlement safety, and other canonical close paths remain authoritative. A pending loss-protection state is superseded if another close is selected. Once confirmed, existing active-plan and execution ownership checks prevent duplicate plans and submissions. The confirmed close uses the existing protective close execution mode.

## Telemetry

The operator emits observational lifecycle events only:

- `LIVE_CONTROL_LOSS_PENDING_STARTED`
- `LIVE_CONTROL_LOSS_PENDING_CANCELLED`
- `LIVE_CONTROL_LOSS_PROTECTION_CONFIRMED`

The persisted payload records pending/confirmed/recovered timing, observed return, policy threshold, confirmation duration, peak/giveback context, active bin, range position, and inventory state. Telegram is informational and is never trading authority.

## Validation

Focused coverage validates threshold boundaries, recovery before confirmation, persistence confirmation, restart preservation, stale evidence suppression, disabled policy, configurable -6%/-10% thresholds, configurable 30/120 second durations, reconciliation and active-plan suppression, and terminal behavior. Existing live-exit-governor and State A tests remain green.

Full CI passed: 1,255 tests passed, 0 failed, 1 skipped; all phase boundaries and migration-static verification passed.

## Invariants

- Existing -12% hard stop: unchanged.
- State A: unchanged.
- Profit protection: unchanged.
- OOR: unchanged.
- Entry and range policy: unchanged.
- Capital and maximum open positions: unchanged.
- Database schema: unchanged; the existing durable JSON exit-state payload is used.

## Release and activation

Final commit, release identity, manifest policy hash, and production alignment are recorded after immutable release activation.
