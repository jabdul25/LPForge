# LPForge Phase 5 — Codex VPS Execution Validation Prompt

You are validating an already-built LPForge Phase 5 release. **Do not redesign architecture, change trading policy, add a signer path, loosen safety controls, or enable mainnet execution.** Treat the repository as authoritative and report evidence.

## Objective

Validate the release on a connected Ubuntu/Debian VPS with Node 24.19+, pnpm 11.21, PostgreSQL 17, a reliable Solana RPC, and live read access to Meteora.

## Mandatory order

1. Verify release checksum and inspect `RELEASE_MANIFEST.json`.
2. Confirm `.env` keeps `LIVE_SIGNING=false`, `LPFORGE_LIVE_EXECUTION=false`, and `LPFORGE_MAINNET_CANARY=false`.
3. Install with frozen lockfile; run strict typecheck/build and `node --test tests/*.test.mjs`.
4. Run P1–P5 boundary scripts and migration static verification.
5. Apply M0001–M0015 to a new temporary PostgreSQL 17 database.
6. Run `DATABASE_URL=<temporary-db> pnpm verify:postgres:phase5` and preserve output.
7. Run API fixture smoke. Confirm non-GET returns 405 `LPFORGE_PHASE5_EXECUTION_API_DISABLED`.
8. Switch only the observation path to `LPFORGE_DATA_MODE=LIVE_READ_ONLY`; validate current Meteora SDK compatibility, a known pool, active bin/bin window, Data API and PositionV2 reads if a test position is supplied.
9. Run Phase 3 shadow and Phase 4 paper paths long enough to prove forward data flow into Phase 5 wallet/plan/simulation preparation.
10. Run `pnpm phase5:fixture`; verify `signingPerformed=false` and `submissionPerformed=false`.

## Devnet execution evidence

Do **not** invent or bypass an execution command. If an operator-approved Devnet test harness/configuration is supplied, validate only Devnet with non-real assets. Preserve each intent, plan, simulation, risk permit, signature, confirmation, reconciliation and recovery journal row. A timeout-after-send must remain UNKNOWN/WAIT until blockhash expiry or observed on-chain truth resolves it.

Do not create a mainnet secret in the repo. Do not paste a secret into logs or prompts. Do not promote from Devnet evidence to mainnet automatically.

## Mainnet canary

Phase 5 mainnet canary remains disabled during this validation unless the human operator separately authorizes a canary after reviewing Devnet and reconciliation evidence. Even if `authorizeMainnetCanary()` reports eligibility, **eligibility is not permission to submit**.

If separately authorized later, retain the Phase 5 hard ceiling and configured lower cap, private/dedicated RPC requirement, pool allowlist, one-position limit, no autonomous ADD/RESHAPE/REBALANCE/scaling, and reconciliation-before-follow-up rule.

## Required final report

Return:

- exact commit/release hash and package versions;
- Node/pnpm/PostgreSQL versions;
- test count and boundary results;
- migration count and execution-table count;
- live Meteora/Solana read evidence;
- Phase 5 dry fixture evidence;
- Devnet submit/confirm/reconcile evidence if explicitly run;
- duplicate/recovery behavior observed;
- reconciliation mismatches;
- unresolved execution journal entries;
- `CANARY_ELIGIBLE` or `HOLD`, with exact blockers;
- confirmation that no mainnet transaction was sent unless separately authorized.
