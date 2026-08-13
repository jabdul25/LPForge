# LPForge Phase 6 Mainnet Canary Operator Handoff v1.0

## Rule
Stop at the first failed gate. Do not change strategy thresholds, risk rules, allowlists, canary caps, signer policy, reconciliation policy or retry semantics merely to obtain PASS.

## Required sequence
1. Verify release integrity and exact source revision.
2. Reproduce Node/pnpm/PostgreSQL versions and run the complete test/boundary/migration suite.
3. Configure at least one dedicated/private write RPC and the required read-provider evidence without storing secrets in source.
4. Configure mainnet owner/signing backend through the supported non-exportable signer integration; never paste secret material into logs or evidence.
5. Configure explicit canary pool allowlist and explicit capital/reserve/loss/action limits.
6. Run mainnet read-only and wallet/pool truth checks.
7. Build only.
8. Simulate only; capture compute/cost/writable-account evidence.
9. Run final pre-sign revalidation.
10. Only with explicit operator authorization, perform one tiny OPEN canary.
11. Confirm and reconcile exact PositionV2 before monitoring.
12. Monitor with HOLD/CLOSE/EMERGENCY_CLOSE only. Do not reshape/rebalance canaries.
13. Close, confirm and reconcile settlement.
14. Exercise recovery/restart evidence without intentionally risking duplicate economic actions.
15. Repeat only according to explicit canary programme policy.
16. Run Phase 6 exit evaluator. Do not treat LIMITED_LIVE_ELIGIBLE as automatic production authorization.

## Forbidden
- autonomous scaling
- non-allowlisted pools
- public RPC as production write endpoint
- blind retry after uncertain send
- a second canary while one is unresolved/open
- production promotion with reconciliation debt
- raw private key/seed in repository, command history or evidence pack
