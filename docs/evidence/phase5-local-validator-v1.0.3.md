# Phase 5 Local Validator and Meteora Evidence — v1.0.3

Date: 2026-08-12

## Environment

- Agave local validator: 4.2.0
- Node.js: 24.19.0
- pnpm: 11.21.0
- PostgreSQL: 17.10
- Meteora SDK: 1.9.8
- Solana web3.js: 1.98.4
- Meteora DLMM program: `LBUZKhRxPF3XUpBCjp4YzTKgLccjZhTSDM9YuVaPwxo`
- Meteora program binary SHA-256: `d296c6771cec945601027613ca637c1be6721044c5859009d41c453477844c1f`

All chain execution below occurred on an isolated loopback Agave validator. No mainnet transaction was sent.

## Generic Solana execution lifecycle

LPForge executed a real local transaction through simulation, ephemeral signing, durable submission, confirmation and reconciliation.

- Signature: `Dw2hQKjWrhcUxHWzGmZbCiyNCfDXzuCPGAspEAWqDHvn2pv9YyEunp5pPAUY7gtaL8WTL8BwQm16acU9qgjyzZ3`
- Simulation: PASS
- Compute units: 150
- Confirmation: CONFIRMED
- Reconciliation: MATCH
- Receiver delta: 890880 lamports
- Ephemeral signer: true
- Secret exposed: false

## UNKNOWN-after-send recovery injection

The transport deliberately submitted the transaction to the local validator and then threw a synthetic RPC timeout. LPForge persisted UNKNOWN rather than assuming failure.

- Actual landed signature: `4dMvAvTX5EGQxkrteLggWT6WRjLsrZNGBfSnJuTL7YbaHvShsYKPRu2s4XAxNn611KotVUkEubXF2pN5wvBt19FF`
- UNKNOWN persisted: PASS
- Original economic effect observed: PASS
- Recovery action: `RECONCILE_FIRST`
- First network send count: 1
- Duplicate retry network send count: 0
- Duplicate retry blocked before send: PASS

## Real local Meteora DLMM lifecycle

The dumped real Meteora DLMM SBF program was loaded at its production program address into the local validator. Two synthetic SPL tokens were created and a customizable permissionless DLMM pair was initialized.

Synthetic pair: `AuCG1cj9X2Tgd7B6cFNV4jAM5E4HivhYY1cvJrdPeWj7`

The reproducible LPForge verifier then executed:

`LPForge OPEN -> PositionV2 -> SWAP -> fee/inventory observation -> LPForge CLOSE`

### Position

- Position: `E2UQEEAQgzxiqzPki51g7BCmfmvFG39nKF6ZybyCXsVF`
- Version: V2
- Range: -10 to +10
- Initial X in position: 999999995 base units
- Initial Y in position: 999999990 base units

### Swap and fee evidence

- Swap input: 50000000 X base units
- Swap output: 49500000 Y base units
- Quoted fee: 400000 base units
- Protocol fee: 100000 base units
- Position fee X after swap: 399999 base units
- Position fee Y after swap: 0
- Active bin before/after: 0 / 0

### Real local signatures

- OPEN: `328dg6M93PDrwCNhZMTegnsV9oWGLCn447tDDfSTnu7NJCHSdTV1o3hZ3g9DkfvEqqoFH4pmrRZewqAuwSFPgVag`
  - simulated compute units: 125490
- SWAP: `qMqimeFEurHEeWp7Z4pKrwTbxeX4UshQhtGpAGKDunN51ZoRu4B2hMTCsK4E1hgNVbi4GYA7VEMjGGW6c3KUqZu`
  - simulated compute units: 33521
- CLOSE: `5iwH7j3MHjjUbBsYqWh3s1pghWWxb68C6Yw9dthMb3Geg9imNqgTfZVkXdjy51wvqwG1YNLSKg9Y6K8dV3iGRtzW`
  - simulated compute units: 157497

Position account existence after close: false.

## Defects found and corrected by real local execution

1. `Connection.simulateTransaction()` overload mismatch for legacy `Transaction` under web3.js 1.98.4.
2. A 1-lamport transfer to a new account was not rent exempt; validation now queries the chain minimum.
3. The operator harness attempted submission persistence before an execution plan/transaction step existed; validation intent/plan/step is now durable before signing/submission.
4. M0017 permits a null pool only for explicitly non-economic `VALIDATION_TRANSFER` intents.

## Regression result after fixes

- Node tests: 176/176 PASS
- P1 boundary: PASS
- P2 boundary: PASS
- P3 boundary: PASS
- P4 boundary: PASS
- P5 boundary: PASS
- Static migrations: M0001-M0017 PASS
- Real PostgreSQL 17.10 blank-database migration/runtime guards: PASS
