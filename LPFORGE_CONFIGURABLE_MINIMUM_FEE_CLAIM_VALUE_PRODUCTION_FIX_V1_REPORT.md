# Configurable routine fee-claim threshold

Implementation in progress. The canonical threshold is `feeClaim.minimumClaimValueUsd` in `policies/live-execution-policy.json`. Routine claims below the value threshold wait; close and settlement claims bypass this routine gate.

