# LPForge Phase 6 Implementation Package v1.0

## Objective
Move LPForge from a Phase 5 execution-capable system to a tightly controlled mainnet-canary system while preserving a strict separation between intelligence, authorization, signing, submission, reconciliation and production promotion.

## Non-negotiable controls
- Mainnet execution is canary-only.
- No default capital threshold is invented; operator policy must explicitly set the canary amount beneath the existing hard ceiling.
- Production write RPC must be classified as dedicated/private; public RPC may be used only as read evidence.
- Pool must be explicitly allowlisted.
- Mainnet wallet reserve is preserved before canary capital is considered available.
- Build and simulation evidence are bound to current pool state.
- Final state/thesis is revalidated immediately before signing.
- Mainnet signer is non-exportable and ticket-bound.
- OPEN is not successful until exact PositionV2 reconciliation MATCH.
- Canary management disables RESHAPE/REBALANCE.
- UNKNOWN submission is never blindly resent while blockhash is valid.
- CLOSE is not successful until the old PositionV2 is absent and settlement reconciliation passes.
- Repeated canary evidence is required for promotion.
- Limited-live eligibility never automatically issues production authority or enables scaling.

## Data model
M0018 adds:
- operations.phase6_canary_sessions
- operations.phase6_canary_observations
- operations.phase6_stage_evidence

## Runtime authority ladder
MAINNET_READ_ONLY -> MAINNET_BUILD_ONLY -> MAINNET_SIMULATE_ONLY -> MAINNET_CANARY_OPEN -> MAINNET_CANARY_CLOSE.

MAINNET_CANARY_MANAGE exists in the contract for future tightly governed management, but Phase 6 canary monitoring itself does not authorize reshape/rebalance.

## Exit status
Software implementation PASS. Operational mainnet promotion HOLD pending real canary evidence.
