# ZCAT closed-position profit-giveback postmortem

Position `8TF4V68vp9VNjHZii1J4DFGKR89ytDPhAvQurWQpSxpT` in pool
`7t477j7S8SDcdg1pzCSvjRjYK3nPc14FmrbzPYTjfHYs` opened at
2026-09-05 13:37:45 UTC and reached receipt-bound `SOL_SETTLED` / `MATCH` at
16:29:11 UTC.

## Chain reconciliation correction (2026-09-05)

The prior wording overstated the status of the final PnL.  Direct finalized
Solana RPC inspection confirms the lifecycle transactions and proves the
position account is closed, but it also establishes that LPForge's
`SOL_SETTLED` value is a **native-SOL cashflow ledger**, not complete economic
mark-to-market settlement:

- The opening transaction is finalized and transferred 29,999,980 lamports
  into the position path.  It also locked 52,234,584 lamports of position rent
  and created the ZCAT token account.
- All 16 transactions indexed to the position, plus the terminal ZCAT unwind,
  are finalized successfully.  The position account no longer exists.
- The close returned 9,307,411 lamports before its 5,000-lamport transaction
  fee.  The final unwind returned 18,940,790 lamports before its
  21,544-lamport transaction fee.  Position rent of 52,234,584 lamports was
  recovered.
- Crucially, the wallet still holds **5.874077814 ZCAT** in
  `3LpCPVirWEGZog23Lc27qvcsyNnsbjZFqZCnmC3t1kAn`.  These are the ZCAT portions
  of routine fee claims; they were not included in the terminal unwind.

Therefore the approximately **-708,981 lamports** LPForge records is valid as
its native-SOL cashflow result (subject to its 20-lamport planned-versus-actual
entry rounding), but it is **not a complete final economic PnL** until the
retained ZCAT is valued at a specified finalized-close price or realized.
It must not be compared directly with a UI USD PnL without adding that asset.

As a transparent, conservative cross-check only, applying the actual terminal
unwind execution price (18,940,790 lamports / 84.003872046 ZCAT =
0.0002254752 SOL/ZCAT) values the retained 5.874077814 ZCAT at approximately
0.001324459 SOL.  That turns the LPForge cash-only result into approximately
**+0.000615478 SOL (+2.05%)**.  This is not asserted as a definitive
mark-to-market price: it is a reproducible execution-price proxy.  It does,
however, explain why a Meteora UI result near +2.7% can coexist with a
cash-only LPForge ledger result near -2.36%.

Likewise, the earlier **+11.9938%** value was an LPForge USD marked-NAV
high-water calculation at 16:04:10 UTC, not “+12% SOL” and not a realized
on-chain profit.  On-chain data can prove token/SOL quantities and execution
status; it cannot prove an off-chain valuation snapshot without the exact
price source and timestamp used by LPForge or Meteora.

## Native-SOL cashflow outcome

The chain settlement is authoritative over the earlier UI and live mark-to-
market snapshots:

- Strategy contribution: 30,000,000 lamports (0.03 SOL).
- LPForge native-SOL cashflow PnL: **-708,981 lamports** (-0.000708981 SOL,
  -2.3633% of strategy capital), excluding the retained 5.874077814 ZCAT.
- Position account rent was 52,234,584 lamports both locked and recovered; it
  is infrastructure rent, not strategy profit or loss.
- Total receipt-bound transaction costs: 106,544 lamports. Of this, routine
  claim transactions cost 60,000 lamports (12 routine claim plans at 5,000
  lamports each); the open and terminal close/unwind steps make up the rest.

The earlier positive UI marks were not final settlement values. The final
close removed liquidity, unwound 84,003,872,046 raw ZCAT for 18,940,790
lamports, executed the required terminal claim, and closed the position
account. This reconciles to the negative *native-SOL cashflow* outcome above,
but not to a complete economic PnL until the retained ZCAT is valued.

## Range result

The 38-bin range `-867..-830` was in range for 10,145.347 seconds and out of
range for 82.745 seconds: **99.19% in-range occupancy**, one brief excursion.
This is materially different from the earlier narrow-range failure and is
strong evidence that range survival itself succeeded for this lifecycle.

## Mark-to-market high water and close decision

The best valid pre-close management valuation was at 16:04:10 UTC:

- managed NAV: $3.4601
- marked net return: +11.9938%
- cumulative gross fees: $0.2646
- inventory value: $3.2012

At 16:28:44 UTC the system issued close plan
`plan-44ac422950a70d442e242577b6f5c547` with:

- marked net return: +6.1500%
- cumulative gross fees: $0.2670
- peak-to-current drawdown: 5.8437 percentage points
- reason: `EXIT_PROFIT_GIVEBACK_LIMIT`

The live exit policy is already profit-aware. Its configured contract is:

- activate after peak net return >= 8%;
- close after giveback >= 5 percentage points;
- require at least 2% retained marked profit.

ZCAT crossed all three conditions. Thus this was neither an OOR exit nor an
unaware late hold: it was the canonical 8% / 5pp / 2% profit-protection close.

## Interpretation

The high-water mark gave back roughly 5.84 percentage points before the close
was submitted. Fees continued to rise slightly near the close, but the marked
inventory component declined faster. The terminal unwind then produced a
receipt-bound final result that was materially below the pre-close mark. This
is primarily inventory/unwind execution-path risk, not range failure.

Routine claim costs were real but not the dominant explanation: 60,000
lamports is 0.2% of 0.03 SOL, materially smaller than the 708,981-lamport
final loss. The new $0.10 routine claim threshold should eliminate this class
of tiny recurring-claim expenditure going forward; it cannot rewrite ZCAT's
historical settlement.

## Counterfactual limits

There is not enough frozen per-bin liquidity/price-impact evidence in this
closed position record to make an exact 0.4-SOL fee-share model defensible.
Under a deliberately labelled price-taking/proportional approximation, the
pre-close high-water percentage remains about +12% (about $4.95 at 0.4 SOL),
while the final settlement percentage remains approximately -2.36% (about
-$0.97 at entry SOL/USD). Fixed transaction costs dilute less at 0.4 SOL, but
larger capital does not itself prevent a percentage profit giveback; it also
scales inventory exposure. A real 0.4-SOL decision therefore requires a
separate frozen pool-depth and execution-impact model.

## Cohort limitation

There are seven compacted settled-position summaries, but they do not retain a
comparable peak-NAV series for every lifecycle. They cannot support a reliable
median peak-to-final giveback calculation. ZCAT alone is enough to confirm
that the existing profit-protection mechanism triggered correctly, but not to
justify changing its thresholds or adding a new trailing rule.
