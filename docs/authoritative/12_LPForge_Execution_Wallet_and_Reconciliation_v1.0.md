> **Project:** LPForge  
> **Suite Version:** 1.0  
> **Design Baseline Date:** 12 August 2026  
> **Status:** Build-guiding baseline  
> **Scope:** Meteora DLMM liquidity intelligence, decisioning, simulation, execution and operations  
> **Principle:** Protocol truth is observed; trading intelligence is inferred; execution is deterministic.  


# LPForge Execution, Wallet and Reconciliation Specification

## 1. Principle

Execution is deliberately unintelligent.

It receives a target-state plan, verifies it is still authorized, builds the current Meteora transaction flow, simulates it, submits it and reconciles actual state.

## 2. Preflight

Immediately before signing:
- policy still active;
- risk approval unexpired;
- plan unexpired;
- active bin within allowed slippage;
- pool status valid;
- reference-price divergence acceptable;
- wallet balance/reserve adequate;
- position pre-state hash matches;
- SDK/program compatibility healthy.

Any failure returns to decision layer; executor does not alter the plan.

## 3. SDK Usage

Prefer current official Meteora TypeScript SDK builders for:
- position creation;
- liquidity addition;
- wide positions;
- claims;
- removal;
- rebalancing;
- swaps if a strategy explicitly requires them.

Low-level instruction construction requires a documented reason and golden comparison against SDK behavior.

## 4. Transaction Construction

Capture:
- instructions;
- accounts;
- expected token deltas;
- expected active-bin tolerance;
- compute budget;
- priority fee policy;
- blockhash;
- simulation logs.

Never log private keys or seed material.

## 5. Simulation

Simulation must reject:
- program errors;
- unexpected token deltas;
- insufficient balance;
- excessive slippage;
- missing bin arrays/accounts;
- unsupported extension;
- excessive compute;
- state drift.

Known DLMM errors should map to stable internal reason codes.

## 6. Wallet Architecture

Recommended:
- trading hot wallet with capped capital;
- separate treasury/cold wallet;
- signer boundary separate from decision API;
- encrypted secret management;
- no seed phrase in repository or general logs.

Signer accepts only an approved structured intent, not an arbitrary transaction supplied by a remote user.

## 7. Send/Confirm

Record:
- send attempt;
- signature;
- RPC endpoint;
- confirmation state;
- error;
- retry classification.

Do not retry unknown failures blindly. First determine whether the original transaction landed.

## 8. Reconciliation

After any state-changing transaction:
1. fetch transaction result;
2. fetch affected position;
3. fetch pool/active-bin state;
4. fetch relevant token balances;
5. compare expected vs observed;
6. update canonical projection;
7. emit discrepancy if mismatched.

## 9. Partial Workflows

If a multi-transaction plan partially succeeds:
- mark `RECONCILIATION_REQUIRED`;
- stop later discretionary steps;
- derive actual on-chain state;
- create a recovery plan from the actual state.

Never assume “transaction 2 failed, therefore transaction 1 rolled back.”

## 10. Idempotency

Before sending:
- check intent not already confirmed;
- check signature history;
- check target state not already achieved.

Retries keep parent intent identity.

## 11. Slippage

Maintain separate controls for:
- active-bin slippage;
- token amount slippage;
- swap price impact;
- reference-price divergence.

Do not collapse them into one generic percentage.

## 12. SOL Handling

Account explicitly for:
- wrapped SOL behavior;
- ATA creation;
- rent;
- transaction fees;
- priority fees;
- returned/leftover lamports.

Wallet accounting must distinguish strategy capital from fee reserve.

## 13. Protocol Change Safety

At startup:
- verify installed SDK version;
- expected program ID;
- IDL/event decoder tests;
- required method availability.

If incompatible, enter `PROTOCOL_COMPATIBILITY_HOLD`.

## 14. Acceptance Criteria

The executor passes:
- duplicate-submit test;
- partial-confirmation test;
- stale-plan test;
- active-bin drift test;
- slippage rejection test;
- RPC failover test;
- Token-2022 compatibility test for supported scope;
- on-chain reconciliation test;
- secret-redaction test.
