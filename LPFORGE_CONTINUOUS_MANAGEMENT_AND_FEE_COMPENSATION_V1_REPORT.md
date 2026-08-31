# LPForge continuous management and fee-compensation observability v1

## Executive finding

An unresolved `CLAIM` could make an owned LP position economically invisible. The Phase-7 recovery-only branch returned before invoking the operator, while the operator was the only component writing durable position observations. A submitted claim that later expired therefore held the action lane in reconciliation and stopped fresh NAV, inventory, bin, fee, and continuation-evidence observations.

`continuous-position-management-v1` separates the read-only observation lane from economic action authorization. `fee-compensation-observability-v1` adds durable MFE, inventory-deterioration, gross-fees-since-MFE, exposure, and evidence-quality fields. Neither adds an exit rule.

## Root cause and old path

```text
owned position
  -> operator live-once
  -> observe/plan management
  -> CLAIM plan submitted
  -> generic recovery could not prove a claim's effect from PositionV2 existence
  -> CLAIM RECOVERING / HOLD_CHAIN_RECONCILIATION
  -> P7 recovery-only short-circuit
  -> operator was not run
  -> no new durable position observation
```

For `plan-c92de7bfb9664736037ac560395aa477`, the last pre-fix durable position observation was `2026-08-31T13:49:21.600Z`.

## New state machine

```text
P7 cycle
  -> read-only owned-position observer (always, best effort)
       -> chain PositionV2 / active bin / range state
       -> inventory, attributed lots, claimable fees, managed NAV
       -> MFE and fee-compensation metrics
  -> action/recovery lane
       -> CLAIM pending/unknown/recovering: no duplicate claim or conflicting action
       -> observation continues
       -> resolved claim: terminalize exactly once
```

The observer has no signer, transaction sender, claim, close, or plan-construction capability. Its child environment forces read-only mode and disables live signing/execution.

## Claim recovery semantics

The claim-specific recovery path distinguishes `CLAIM_CONFIRMED`, `CLAIM_NOT_EXECUTED`, effect already present, and still-unknown chain status. An expired signature is terminalized only after a successful chain status read establishes expiry/no effect. It is never replayed.

For the live claim:

| Item | Evidence |
| --- | --- |
| Plan | `plan-c92de7bfb9664736037ac560395aa477` |
| Submitted signature | `5u8Zdi63Xx2UrUqgX79WDkh8E1aZy2nzLQJdCQRsAKgmx3g4UV6ss7hesLjWUpQZ4H1R8TbiqkFXAaKoHgkdxt2f` |
| Pre-fix state | `RECOVERING` |
| Terminal state | `EXPIRED` |
| Recovery classification | `CLAIM_NOT_EXECUTED` |
| Chain effect | `NONE` / claim effect absent |
| Reconciliation | `MATCH`, `2026-08-31T17:35:15.457Z` |
| Resubmission | No |

The signature and expired-submission history remain intact. The recovery inserts no fee cashflow for a no-effect claim. Confirmed claims use deterministic cashflow identities so claimed plus claimable position-attributable fees are counted once.

## Durable observability design

M0066 adds append-only `execution.position_management_metrics`. New observation rows record managed NAV/current return, MFE NAV/return/time/bin, inventory value, cumulative gross fees, deterioration and fees since MFE, compensation ratio, token/SOL shares, flow-evidence status, continuation evidence/reason, action-lane state, and hold classification.

MFE advances only on a higher reconciled managed NAV. Historical rows were not backfilled or altered. The MFE baseline for this existing lifecycle therefore begins at its first durable M0066 observation rather than fabricating past history.

The observational compensation formula is:

```text
fees since MFE / max(0, MFE inventory value - current inventory value)
```

The validated forensic fixture remains `0.000484598 / 0.000961169 = 0.5042`; it is a test/observability value, not an exit threshold.

## Current live proof

At `2026-08-31T17:48:23.123Z`, LPForge persisted a new observation for `HVEbGMQx9xW1yDmo9zgpzNyFQXt6W4YqR3uPTxbNNZtp` in pool `EsR3gRxMtqt3bBhDDsuY3SFyYNYvYzszzG9KVYpcQfs7`:

| Field | Value |
| --- | --- |
| Range / active bin | `-578..-568` / `-587` |
| Range state | `OUT_OF_RANGE`, below minimum |
| Position inventory | `8,946,690,677` token-X raw, `0` WSOL raw |
| Claimable fee Y | `801,666` raw |
| Managed NAV | `$2.8060328307` |
| Current return | `-9.70865034%` |
| MFE baseline | `$2.8735278109` at `2026-08-31T17:35:51Z`, bin `-585` |
| Inventory deterioration since MFE | `$0.0680176123` |
| Gross fees since MFE | `$0.0005341865` |
| Fee-compensation ratio | `0.0078536496` |
| Exposure | token `100%`, SOL `0%` |
| Flow evidence | `FLOW_EVIDENCE_UNAVAILABLE` |
| Continuation evidence | unavailable: `CONTINUATION_CURRENT_POOL_CONTEXT_UNAVAILABLE` |
| Hold classification | `HOLD_INSUFFICIENT_EVIDENCE` |

This is an observational classification only (`PARTIALLY_FEE_COMPENSATED`). The existing OOR/risk policy remains the sole authority for any economic action. No compensation or MFE-based automatic close was introduced.

## Migration and test evidence

- Migration: `M0066_continuous_management_fee_compensation.sql`, applied at `2026-08-31T17:35:10.304Z`.
- Final focused tests: 24/24 pass.
- Earlier core claim/management focused tests: 38/38 pass.
- Canonical CI: 909/909 pass, phase boundaries and migration static checks pass.
- Release integrity: PASS, immutable release source `9ff90fe64d62bb35c5d0241dd3a713bb79d3e025`, migration head M0066.

## Historical replay

Only the current lifecycle had sufficient compatible retained evidence. The prior forensic’s reconstructed peak-to-adverse segment is retained as a read-only fixture. M0066 does not fabricate continuous historical MFE/flow data for older positions; unavailable history remains unavailable.

## Deployment and health

Production was restarted onto `9ff90fe64d62bb35c5d0241dd3a713bb79d3e025`. Execution remains on `19653348e96c5edf898a7fbc5f6aeefc1e801f5b`, which contains the claim recovery logic and is online. No discovery service was restarted.

At final verification: one owned position is active; pending plans `0`; reservations `0`; UNKNOWN submissions `0`; reconciliation debt `0`. P7 is `PRODUCTION / HEALTHY / NORMAL` with `OBSERVE_ONLY` current plan because the one-position portfolio limit is occupied and drift is WATCH. No transaction was manually sent, no claim was manually executed, and no database row was manually changed.

## Remaining limitations

- The current position has no valid continuation evidence and flow evidence is unavailable; that absence is now explicit rather than treated as economically favorable.
- Compensation measurements require future durable observations; no policy threshold has been inferred from this single lifecycle.
- Operator UI presentation is not changed by this release; durable database/operator logs provide the new facts.
