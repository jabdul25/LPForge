# Position-attributed fee inventory and terminal unwind fix

## Root cause

Routine Meteora fee claims already create receipt-bound `FEE_CLAIM` inventory
lots in `execution.position_inventory_lots`.  The terminal close path used
only `wallet_after_close - wallet_before_close`; it therefore unwound newly
removed position inventory but excluded the same position's earlier claimed
token fees, which were already present at the pre-close snapshot.

## Canonical correction

The close path now derives the maximum safe terminal unwind as:

`newly withdrawn close inventory + OPEN/PARTIALLY_SETTLED FEE_CLAIM lots for
the same position and mint`.

Lots are ordered by `acquired_at, lot_id`, the wallet must contain at least
that exact total, and the Jupiter unwind is receipt-reconciled before any lot
is marked settled.  Inventory from another position or manual wallet holdings
is never inferred from aggregate wallet balance and is never swapped.

## ZCAT regression fixture

- Position: `8TF4V68vp9VNjHZii1J4DFGKR89ytDPhAvQurWQpSxpT`
- Historic routine-fee ZCAT lots: `5.874077814 ZCAT`
- Newly removed/terminal-claimed ZCAT: `84.003872046 ZCAT`
- Correct attributable terminal amount: `89.877949860 ZCAT`

The historical close unwound only the latter amount.  Under the corrected
path, the former is selected only through its receipt-backed lots—not because
it happens to be in the wallet.

## Accounting semantics

`nativeSolCashflowPnl` remains a receipt-bound SOL-only number.  It must not
be labelled final economic PnL when a position-attributed non-SOL lot remains.
Such a lot is either unwound and receipt-settled, or retained as explicit
dust/inventory requiring a sourced valuation for marked economic PnL.
