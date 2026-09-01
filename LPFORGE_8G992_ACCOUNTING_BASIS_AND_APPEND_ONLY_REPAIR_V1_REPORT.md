# LPFORGE 8G992 accounting-basis and append-only repair v1

Date: 2026-08-31 UTC  
Target only: `8G992HY1y4YBGxcHkL9DNXVKLAp7xk1AnD5ae9DwbjsQ`

## Executive conclusion

The five-lamport discrepancy was a historical cashflow-representation error,
not a trading-policy or economic-policy issue. The entry requested and wrapped
`30,000,000` lamports, but confirmed Meteora liquidity received exactly
`29,999,995`; the five-lamport temporary-WSOL remainder returned to the wallet
when that temporary account closed in the same entry transaction.

Current reconciled opens already make actual confirmed chain-funded capital
authoritative for `OPEN_CONTRIBUTION`, retaining configured capital as strategy
metadata. Applying that existing convention to 8G992 is an accounting semantic
clarification, not a policy change.

## Identity and chain proof

| Field | Value |
|---|---:|
| Lifecycle | `lifecycle:8G992HY1y4YBGxcHkL9DNXVKLAp7xk1AnD5ae9DwbjsQ` |
| Pool | `EsR3gRxMtqt3bBhDDsuY3SFyYNYvYzszzG9KVYpcQfs7` |
| Pair | NEEGY / WSOL |
| Pre-repair latest settlement | v2, `-29,712,167` lamports |
| Required corrected result | v3, `-32,525` lamports |
| Migration head | `M0067_terminal_fee_claim_settlement_reconciliation.sql` |

Opening signature:
`4ynFFrJfVJWRuNaZ1JUcdzsaNui37yMTyb5ZF9WTZevH2WKsjiZMXTEsX9DrqpExqhiw9vjKNwJfoHVPLsoEwX8x`
(slot `442606691`, 2026-08-29 12:28:37 UTC) proves:

| Entry fact | Lamports |
|---|---:|
| Configured/requested capital | 30,000,000 |
| Native transfer to temporary WSOL | 30,000,000 |
| Confirmed WSOL transfer into Meteora liquidity | 29,999,995 |
| Temporary WSOL dust returned at account close | 5 |

The old non-chunked reconciler persisted the requested 30,000,000 as
`OPEN_CONTRIBUTION`. The current chunked path in
`packages/phase6-live-worker/src/index.ts` instead persists
`actualEconomicCapitalLamports`, while retaining requested capital in payload
and position metadata. Thus chain-funded capital is the realized cashflow
basis; configured capital remains strategy intent and the current return
denominator.

Removal signature:
`3UWxD23v1Cuf1y6i52P3hX9bz7zXDkfcf7VmXffqXspoastpUbxUX8oFS8sNBj5gH8S45yoYWvNaXKJnkN8qQvXM`
(slot `442607454`, 2026-08-29 12:32:41 UTC) was re-read immediately before
the write. Owner post-balance minus pre-balance plus its 5,000-lamport fee was
exactly `29,679,637` lamports, matching both native and WSOL transfer effects.

## Exact v3 chain waterfall

| Component | Lamports |
|---|---:|
| Exact funded entry contribution | -29,999,995 |
| Position rent lock | -57,406,080 |
| Transaction costs | -25,454 |
| Swap proceeds | +313,287 |
| Position rent recovery | +57,406,080 |
| Remove-native receipt | +29,679,637 |
| **SOL in** | **87,399,004** |
| **SOL out** | **87,431,529** |
| **Net realized PnL** | **-32,525** |

Return remains `-32,525 / 30,000,000 = -0.10841667%`, because existing
learning/reporting uses configured strategy capital as its denominator while
realized PnL uses exact chain cashflows.

## Approved append-only repair

At 2026-08-31 20:43:55.325 UTC the explicitly allowlisted utility appended:

1. `OPEN_CONTRIBUTION -5`, effect
   `ENTRY_BASIS_ROUNDING_CORRECTION`, bound to the opening signature.
2. `CLOSE_WITHDRAWAL +29,679,637`, effect
   `REMOVE_NATIVE_WITHDRAWAL`, bound to the finalized removal signature.

Each cashflow uses a stable `lifecycle + signature + effect` key. The target
now has 11 cashflows. No settlement was updated or deleted:

| Settlement | Net | SOL in | SOL out | Result |
|---|---:|---:|---:|---|
| v1 | -87,118,247 | 313,287 | 87,431,534 | preserved |
| v2 | -29,712,167 | 57,719,367 | 87,431,534 | preserved |
| v3 | **-32,525** | 87,399,004 | 87,431,529 | `RECONCILED_CHAIN` |

M0067's independent terminal reconciliation reports chain and DB terminal net
of `87,383,550` lamports, zero difference, and no reason codes. The entry
basis is separately chain-proven in v3's immutable audit payload.

## Scope and non-target proof

The writer contains only the fixed 8G992 position address; it has no dynamic
SOL_SETTLED selection and uses INSERTs only. HVE, 8HU, GRyr, F3, Drb, and Bhh
were not written. Post-write records remain:

| Position | Latest settlement | Net lamports | Cashflows |
|---|---:|---:|---:|
| HVEbGM...NZtp | v2 | -1,925,242 | 17 |
| 8HU47...1Pzw | v2 | +1,387,553 | 15 |
| GRyrKY...hqC2 | v3 | -313,759 | 13 |
| F3V7UH...ue1k | v2 | -115,822 | 14 |
| DrbJX...MK7w | v2 | -406,220 | 14 |
| BhhRQ...gpEx | v2 | +320,468 | 11 |

Reruns are safe: once v3 exists, the exact-v2 precondition refuses the tool
before any INSERT, preventing a duplicate cashflow or settlement.

## Updated seven-lifecycle scorecard

| Position | Version | Net lamports | Return on 0.03 SOL | Reconciliation |
|---|---:|---:|---:|---|
| 8G992...bjsQ | v3 | -32,525 | -0.1084% | RECONCILED_CHAIN |
| 8HU47...1Pzw | v2 | +1,387,553 | +4.6252% | legacy status unavailable |
| BhhRQ...gpEx | v2 | +320,468 | +1.0682% | RECONCILED_CHAIN |
| DrbJX...MK7w | v2 | -406,220 | -1.3541% | RECONCILED_CHAIN |
| F3V7UH...ue1k | v2 | -115,822 | -0.3861% | RECONCILED_CHAIN |
| GRyrKY...hqC2 | v3 | -313,759 | -1.0459% | legacy status unavailable |
| HVEbGM...NZtp | v2 | -1,925,242 | -6.4175% | RECONCILED_CHAIN |

Total: `-1,085,547` lamports, exactly matching the earlier full
chain-reconstructed aggregate. Winners/losses: 2/5. Win rate: 28.57%. Mean:
`-155,078` lamports. Median: `-115,822`. Aggregate return: `-0.5169%`.
Largest win: `+1,387,553`; largest loss: `-1,925,242`; profit factor: `0.611`.

## Validation and runtime health

- Focused tests: 5/5.
- Canonical CI: 917/917 passing, including all boundary and migration checks.
- Source before: `42a0e08b726acbd0ff3a1c2fced0e84a16337b75`.
- Source after: `c7be59fb582954fc2a2a9f48a63272194336f1b8`.
- Immutable artifact SHA-256:
  `1082a54b73d23f5dfc4d70f2ceceb410109f7e597da428a382df28bd3afb1fb7`.
- Artifact integrity: PASS. No migration ran.
- This is operator-only historical accounting tooling. No production service
  restart/reload occurred; production/execution runtime remains
  `9863742e7c39ab78c6466729b425236c14d1cc0c`.
- P7: `PRODUCTION / HEALTHY / WATCH / NORMAL / OBSERVE_ONLY`, with new
  economic actions disabled.
- One current OPEN position (`BcHk...L2J1`, EsR3 pool, 0.03 SOL) existed and
  was not changed. Pending plans: 0; reservations: 0; UNKNOWN: 0;
  reconciliation debt: 0.

No trading, entry, exit, OOR, Candidate-Primary, P3/P4/P7, capital, strategy,
range, or event-path behavior was changed.
