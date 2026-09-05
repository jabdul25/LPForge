# Configurable minimum routine fee-claim value

## Canonical contract

`policy/live-execution-policy.json` owns `feeClaim.minimumClaimValueUsd`,
initially `0.10`. The deployment-policy parser validates it as a finite,
strictly-positive bounded number and exposes it to the production operator.

For an OPEN position, the canonical management cycle values all claimable fee
assets using the same pool-price orientation and token-decimal normalization
used by the existing position monitor. It sums those values before deciding
whether routine fee collection is eligible.

- Below the threshold, it emits a durable `WAIT` observation with
  `FEE_CLAIM_BELOW_MINIMUM_VALUE`; no claim transaction is built, signed, or
  submitted.
- At or above the threshold, the existing claim path remains responsible for
  claiming the full claimable balance, subject to its existing net-benefit,
  simulation, in-flight, signing, and reconciliation controls.
- An unavailable nonzero asset valuation remains fail-closed for routine
  claims with `FEE_CLAIM_VALUE_UNAVAILABLE`.
- Close, settlement, and terminalization are evaluated before the routine
  claim gate, so the value threshold never prevents mandatory settlement.

Routine evaluation is persisted in `execution.position_observations` under
`management_context.routineFeeClaimEvaluation`, including the normalized
claimable value, configured threshold, decision, and reason codes.

## Regression coverage

Focused coverage verifies below-threshold, just-below, exact-threshold,
above-threshold, multi-asset, decimal-normalization, unavailable-price,
in-flight, configuration-change, invalid-configuration, close, and
terminalization behavior. The immutable-release launch regression test also
verifies that discovery registrations are recreated on deployment, preventing
PM2 from retaining an old release working directory.

## Live deployment observation

The previously observed ZCAT position
`8TF4V68vp9VNjHZii1J4DFGKR89ytDPhAvQurWQpSxpT` was already reconciled as
`SOL_SETTLED` before this deployment. At its final pre-settlement routine
observation, claimable value was approximately `$0.01636`, below the new
`$0.10` threshold; it did not produce a post-deployment routine claim. No
manual claim was performed as part of this change.

The final immutable-release and Git alignment are reported by the deployment
handoff for this change.
