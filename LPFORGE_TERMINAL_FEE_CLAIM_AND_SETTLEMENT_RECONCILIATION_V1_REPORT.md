# LPFORGE terminal fee claim and settlement reconciliation v1

## Executive finding

The terminal close path executed a confirmed `METEORA_CLAIM` child transaction
but did not run the receipt-backed fee-cashflow ingestion used by ordinary
claims and claim recovery.  `SOL_SETTLED` then accepted an internally
self-consistent but incomplete `position_cashflows` set.  This release makes
the close claim receipt a signature-bound, idempotent `FEE_CLAIM` cashflow and
requires a separate receipt-derived reconciliation of the terminal close-plan
transaction set before settlement finalization.

No trading, entry, exit, OOR, capital, Candidate-Primary, P3/P4/P7, or
event-path policy was changed.

## Root cause and old sequence

`packages/phase6-live-worker/src/index.ts::executeCloseSettlement` built and
submitted the terminal `METEORA_CLAIM` child after liquidity removal.  Unlike
the ordinary `CLAIM` `afterConfirmed` path and
`persistRecoveredClaimReceipt`, that child supplied no `afterConfirmed`
cashflow ingestion.  The finalizer only re-persisted the remove native
withdrawal and position rent recovery, then
`packages/db/src/index.ts::assessLifecycleSettlement` summed DB cashflows.
The missing terminal claim therefore produced a false internal reconciliation
of zero difference.

## Corrected sequence

1. A confirmed terminal `METEORA_CLAIM` invokes
   `persistConfirmedClaimReceipt`.
2. It inserts the confirmed native/WSOL and token fee effect under a stable
   `planId + transactionId + effect` cashflow ID. Re-reading the receipt or
   restarting updates the same row rather than creating a duplicate.
3. `finalizeClosedPositionSettlement` repeats receipt ingestion for the
   terminal claim before assessment, covering a crash after transaction
   confirmation.
4. `reconcileTerminalSettlementChainEffects` independently loads every
   confirmed CLOSE-plan receipt and verifies transaction fees, terminal claims,
   remove native withdrawal, Jupiter unwind proceeds, and PositionV2 rent
   recovery against signature-bound cashflows.
5. The independent result is persisted in
   `execution.lifecycle_settlement_chain_reconciliations`. A mismatch leaves
   the lifecycle/plan in reconciliation rather than allowing `SOL_SETTLED`.

`M0067_terminal_fee_claim_settlement_reconciliation.sql` is forward-only; it
adds this reconciliation evidence table and does not change historical rows.

## Cashflow and PnL semantics

The terminal claim is represented as `FEE_CLAIM`, not as embedded removal
principal.  Close attribution now records it as `claimed_fee_*` where the
pre-close fee is WSOL, leaving only genuinely embedded fees in
`embedded_remove_fee_*`.  This prevents live-learning fee decomposition from
counting the same terminal fee both as a direct claim and embedded fee.

The settlement convention remains `gross-sol-instruction-flows-v1`: all
position-attributable fee claims, actual token-unwind receipts and permitted
rent recovery are included; actual transaction/swap costs are outflows.  The
release does not attempt to match Meteora's removal-time UI scope.

## HVEbGM regression

For `HVEbGMQx9xW1yDmo9zgpzNyFQXt6W4YqR3uPTxbNNZtp`:

| Chain-derived cashflow | Lamports |
| --- | ---: |
| Entry capital | -30,000,000 |
| Prior confirmed fee claims | +122,976 |
| Terminal claim (`5gGiu...YkVU6k`) | +801,666 |
| Primary NEEGY unwind | +26,820,629 |
| Residual NEEGY unwind | +374,489 |
| Transaction costs | -45,002 |
| Correct realized net | **-1,925,242** |

The old immutable settlement is `-2,726,908`; the exact difference is the
omitted `801,666` terminal fee claim.  The deterministic test fails when that
cashflow is removed.

## Historical blast radius (read-only)

The production audit found seven `SOL_SETTLED` lifecycles. Six have a
confirmed terminal `METEORA_CLAIM` child; one has a signature-linked fee
cashflow and five do not. The missing-cashflow candidates are:

- `BhhRQ...gpEx` — pre-close WSOL fee snapshot: 175,671 lamports.
- `DrbJX...MK7w` — pre-close WSOL fee snapshot: 39,798 lamports.
- `HVEbGM...NZtp` — chain-confirmed terminal receipt: 801,666 lamports.
- `F3V7UH...ue1k` — confirmed claim, amount requires receipt-level repair
  evidence.
- `GRyrKY...hqC2` — confirmed claim, amount requires receipt-level repair
  evidence.

The remaining settled position had no terminal claim child; `8HU47...1Pzw`
has a signature-linked claim cashflow. No historical row was altered.

### Historical repair plan

Do not mutate immutable settlements. For each candidate, retrieve the
confirmed transaction receipt, prove the lifecycle owner receipt and token
effects, append a provenance-rich corrective cashflow with the stable
signature-derived identity, and create an immutable superseding settlement
version only after the same chain reconciliation passes. Rows without a
complete receipt remain `INSUFFICIENT_EVIDENCE`.

## Tests

Focused accounting, lifecycle settlement, close settlement, close recovery,
and claim recovery tests passed: **36/36**. The full canonical CI passed
(`pnpm test:ci`). The new tests cover receipt-vs-cashflow mismatch, the
signature-bound terminal claim path, and the complete HVEbGM cashflow
regression.

## Deployment and limitations

Deployment evidence and runtime verification are added after the migration and
affected-worker release. This release intentionally does not repair historical
records automatically and cannot retroactively obtain unavailable RPC receipt
data. The external reconciliation is a final-close integrity guard; it does
not create a trading decision or an autonomous exit rule.
