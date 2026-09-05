# Configurable dust settlement policy V1

The canonical live policy owns `settlement.residualDustThresholdUsd`; Production
is explicitly configured at `0.10` USD. Settlement accepts retained dust only
after a fresh Meteora pool-token USD valuation, an exact owner-wallet versus
attributed-lot balance match, and receipt-bound inventory provenance.

The DOGE-1 close reconciled the historical aggregate REMOVE+CLAIM attribution
overlap using the confirmed Jupiter receipt, retained the exact residual as
`DUST_RETAINED`, and reached `SOL_SETTLED` without a cleanup swap. Retained
dust remains in the append-only inventory ledger and is not free entry capital.
