# LPForge Phase 5 Implementation Package v1.0

**Date:** 12 August 2026  
**Phase:** Controlled Execution, Wallet Safety and Reconciliation  
**Implementation status:** PASS  
**Operational promotion status:** HOLD

## 1. Mandate

Phase 5 converts an approved Phase 4 paper-management action into a controlled execution lifecycle without allowing strategy code to directly own signing or submission authority.

The Phase 5 control chain is:

`Phase 4 approved action → wallet truth → execution intent → transaction plan → Meteora builder → cost/compute → simulation → execution risk permit → isolated signer → durable submission → confirmation/expiry → on-chain reconciliation → recovery journal → canary governor → position truth`

## 2. Authority ladder

Phase 5 uses explicit authority levels:

- `READ_ONLY`
- `BUILD_ONLY`
- `SIMULATE_ONLY`
- `DEVNET_SIGN`
- `DEVNET_SUBMIT`
- `MAINNET_BUILD_SIMULATE`
- `MAINNET_CANARY`

Default authority is `BUILD_ONLY`. `LPFORGE_LIVE_EXECUTION=false`, `LPFORGE_MAINNET_CANARY=false`, and the inspection API never exposes transaction execution.

## 3. Stage register

| Stage | Capability | Exit condition |
|---|---|---|
| P5-01 | Execution contracts and authority boundary | Explicit capability/authority model; no uncontrolled sign/send path. |
| P5-02 | Wallet observation and capital truth | Native/token/position/reservation truth with slot consistency. |
| P5-03 | Deterministic transaction-plan builder | Idempotent OPEN/ADD/RESHAPE/REBALANCE/REDUCE/CLAIM/CLOSE plans. |
| P5-04 | Meteora open/add builder | Real SDK types/build path without signing/sending. |
| P5-05 | Remove/close/claim builder | One-or-many transaction preservation; full-remove close guard. |
| P5-06 | Management execution ordering | Remove → reconcile → refresh wallet → build/open replacement. |
| P5-07 | Compute and execution-cost intelligence | Simulation-CU margin and explicit fee/capital policy. |
| P5-08 | Simulation gateway | Authority-gated simulation evidence with freshness. |
| P5-09 | Execution Risk Governor | Independent pre-sign veto with short-lived permit. |
| P5-10 | Signer abstraction and isolation | Strategy never receives secret material. |
| P5-11 | Devnet signing harness | Ephemeral devnet-only real signature; no exported secret. |
| P5-12 | Submission and confirmation engine | Durable PREPARED-before-send, unknown-send semantics, blockhash expiry. |
| P5-13 | On-chain reconciliation | Signature alone is insufficient; intended vs actual state must MATCH. |
| P5-14 | Recovery and idempotency | WAIT while blockhash valid; rebuild only after expiry + absence proof. |
| P5-15 | Mainnet canary governor | Explicit flags/private RPC/allowlist/cap/evidence/one-position ceiling. |
| P5-16 | Evidence and promotion review | Full regression + runtime persistence + promotion decision. |

## 4. Main safety invariants

1. Strategy/intelligence modules cannot call Solana send methods directly.
2. Meteora mutation builders are isolated in `packages/meteora-execution`.
3. `sendRawTransaction` is isolated in `packages/execution-submission`.
4. `Keypair.fromSecretKey` is prohibited by the Phase 5 scanner.
5. `Keypair.generate` is restricted to the devnet signing harness.
6. Unknown submission before blockhash expiry means WAIT, not resubmit.
7. A confirmed signature does not authorize a follow-up action until reconciliation is `MATCH`.
8. Replacement liquidity after RESHAPE/REBALANCE cannot be opened until removal reconciliation and refreshed wallet truth complete.
9. Mainnet canary is off by default and cannot be inferred from strategy confidence.
10. No HTTP execution endpoint exists in Phase 5.

## 5. Mainnet canary policy

The implementation hard ceiling is `100,000,000` lamports (0.1 SOL) per canary OPEN. A configured canary cap must be positive and cannot exceed that ceiling.

Canary authority additionally requires explicit live/canary flags, private/dedicated RPC classification, pool allowlist, sufficient Devnet confirmed/reconciled evidence, zero reconciliation debt, tested recovery/emergency stop evidence, daily action limits and a one-open-position ceiling.

Only `OPEN`, `CLOSE` and `EMERGENCY_CLOSE` are allowed by the canary governor. Autonomous `ADD`, `RESHAPE`, `REBALANCE` and scaling remain prohibited.

## 6. Database lineage

Phase 5 adds:

- `M0012_phase5_execution_control.sql`
- `M0013_phase5_reconciliation.sql`
- `M0014_phase5_execution_journal.sql`
- `M0015_phase5_mainnet_canary.sql`

Execution persistence includes intents, transaction plans/steps, simulations, risk permits, submission attempts, confirmations, reconciliations, execution journal and canary runs.

## 7. Validation result

Final software gate after runtime-discovered regression repair:

- Node.js 24.19.0: PASS
- pnpm 11.21.0 frozen/offline dependency graph: PASS
- strict TypeScript typecheck: PASS
- TypeScript build: PASS
- automated tests: **159/159 PASS**
- P1/P2/P3/P4/P5 boundary scans: PASS
- M0001–M0015 static migration verification: PASS
- PostgreSQL 17.10 blank-database migration: PASS
- actual Node `pg` Phase 5 persistence contract: PASS
- API state-changing request rejection: PASS
- `LIVE_SIGNING=true` startup refusal: PASS

## 8. Runtime defect found by PostgreSQL validation

The real PostgreSQL contract found that `markSubmissionUnknown()` passed an untyped bind parameter to the polymorphic `jsonb_build_object()` function. PostgreSQL 17 rejected it with SQLSTATE `42P18` (`could not determine data type of parameter $3`).

The adapter now explicitly casts the error bind as text. A permanent regression test and `scripts/verify-phase5-postgres-contract.mjs` were added. The full 159-test suite and real database contract were rerun after the fix.

## 9. Promotion status

**Implementation:** PASS.  
**Operational promotion:** HOLD.

The HOLD is intentional because this sandbox could not establish connected Meteora/Solana reads and no actual Devnet submit→confirm→reconcile evidence has been collected. Mainnet canary evidence is therefore zero. Phase 5 does not promote itself merely because software tests pass.

## 10. Next host validation

A connected target host should run read-only Meteora/Solana compatibility first, then explicit Devnet execution/reconciliation trials. Only after the evidence policy is satisfied may the canary governor report `CANARY_ELIGIBLE`. Mainnet submission remains a separate operator-controlled promotion decision.
