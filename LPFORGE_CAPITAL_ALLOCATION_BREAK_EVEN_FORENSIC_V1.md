# LPForge Capital Allocation Break-Even Forensic V1

## Scope and method

Read-only audit at 2026-08-31 UTC. The cohort is the seven `SOL_SETTLED`
lifecycles using the latest immutable, chain-reconciled settlement version only.
No current position, policy, source, migration, or runtime state was changed.

For each lifecycle, realized fees and transaction costs are summed from
`execution.position_cashflows`. `inventory/unwind residual` is derived as:

```
latest realized net - realized fee cashflows + transaction costs
```

This avoids the stale pre-correction `position_realized_economics` decompositions
for repaired lifecycles. Rent is net zero under the current settled accounting
convention and is not treated as trading PnL.

## Corrected actual economics at 0.03 SOL

Amounts below are SOL; values in parentheses are the authoritative latest
settlement version. `Active time` is only shown where durable OOR duration makes
it derivable; it is otherwise `UNKNOWN`, not estimated.

| Position | Version | Fees | Inventory/unwind residual | Tx cost | Net | Return | Hold | Active |
|---|---:|---:|---:|---:|---:|---:|---:|---:|
| 8HU47…1Pzw | v2 | 0.000145064 | +0.001296073 | -0.000053584 | +0.001387553 | +4.6252% | 6.101h | UNKNOWN |
| 8G992…bjsQ | v3 | 0 | -0.000007071 | -0.000025454 | -0.000032525 | -0.1084% | 7.014h | UNKNOWN |
| F3V7UH…ue1k | v2 | 0.000028328 | -0.000109150 | -0.000035000 | -0.000115822 | -0.3861% | 0.120h | UNKNOWN |
| GRyrKY…hqC2 | v3 | 0 | -0.000278759 | -0.000035000 | -0.000313759 | -1.0459% | 3.241h | UNKNOWN |
| DrbJX…MK7w | v2 | 0.000039798 | -0.000411018 | -0.000035000 | -0.000406220 | -1.3541% | 6.217h | UNKNOWN |
| BhhRQ…gpEx | v2 | 0.000350653 | -0.000000185 | -0.000030000 | +0.000320468 | +1.0682% | 4.351h | 0.682h |
| HVEbGM…NZtp | v2 | 0.000924642 | -0.002804882 | -0.000045002 | -0.001925242 | -6.4175% | 6.034h | 5.519h |

The corrected aggregate is **-0.001085547 SOL**. Fees total
**+0.001488485 SOL**, inventory/unwind residual totals **-0.002314992 SOL**,
and transaction costs total **-0.000259040 SOL**.

## Cost structure and break-even

`Scalable component = fee + inventory/unwind residual`; transaction fees are
held fixed only in Scenario B. The transaction-cost drag at 0.03 SOL is
0.085%–0.179% per lifecycle (mean 0.123%).

| Position | Fee return | Tx drag | Inventory-loss tolerance before net loss | Fee / inventory-loss compensation | Fixed-cost break-even capital |
|---|---:|---:|---:|---:|---:|
| 8HU47 | 0.4835% | 0.1786% | 0.3049% | n/a (inventory gain) | 0.00112 SOL |
| 8G992 | 0.0000% | 0.0848% | -0.0848% | 0.0% | none; scalable component negative |
| F3V7UH | 0.0944% | 0.1167% | -0.0222% | 25.95% | none; scalable component negative |
| GRyrKY | 0.0000% | 0.1167% | -0.1167% | 0.0% | none; scalable component negative |
| DrbJX | 0.1327% | 0.1167% | 0.0160% | 9.68% | none; scalable component negative |
| BhhRQ | 1.1688% | 0.1000% | 1.0688% | 1,895% (near-zero loss) | 0.00257 SOL |
| HVEbGM | 3.0821% | 0.1500% | 2.9321% | 32.97% | none; scalable component negative |

For the two positive scalable cases, 0.03 SOL is already far above the
fixed-cost break-even. Five of seven lifecycles have a negative scalable
component, so no capital increase can make them profitable under proportional
economics.

## Capital models

Scenario A scales every component linearly. Scenario B scales fees and
inventory/unwind residual linearly but holds observed transaction cost fixed.
Both are mechanical counterfactuals, not execution forecasts.

| Capital | Scenario A cohort net | Scenario B cohort net | Scenario B mean return |
|---:|---:|---:|---:|
| 0.03 SOL | -0.001085547 | -0.001085547 | -0.5169% |
| 0.05 SOL | -0.001809245 | -0.001636552 | -0.4676% |
| 0.10 SOL | -0.003618490 | -0.003014063 | -0.4306% |
| 0.15 SOL | -0.005427735 | -0.004391575 | -0.4182% |
| 0.20 SOL | -0.007236980 | -0.005769087 | -0.4121% |
| 0.30 SOL | -0.010854700 | -0.008524110 | -0.4059% |
| 0.50 SOL | -0.018091450 | -0.014034157 | -0.4010% |

The proportional cohort return is unchanged at -0.5169%. Removing the
fixed-cost percentage drag improves it toward the scalable-component return of
about -0.3936%, but never changes the sign.

Per-lifecycle Scenario B is `((fee + inventory residual) × capital / 0.03) -
observed tx cost`; Scenario A is `actual net × capital / 0.03`. Thus 8HU and
Bhh improve at larger capital, while 8G992, F3, GRyr, Drb, and HVE remain
negative at every requested allocation. Larger capital magnifies HVE's adverse
inventory result rather than repairing it.

Exact Scenario B net-PnL outputs (SOL):

| Position | 0.03 | 0.05 | 0.10 | 0.15 | 0.20 | 0.30 | 0.50 |
|---|---:|---:|---:|---:|---:|---:|---:|
| 8HU47 | +0.001387553 | +0.002348311 | +0.004750206 | +0.007152101 | +0.009553996 | +0.014357786 | +0.023965366 |
| 8G992 | -0.000032525 | -0.000037239 | -0.000049024 | -0.000060809 | -0.000072594 | -0.000096164 | -0.000143304 |
| F3V7UH | -0.000115822 | -0.000169703 | -0.000304407 | -0.000439110 | -0.000573813 | -0.000843220 | -0.001382033 |
| GRyrKY | -0.000313759 | -0.000499598 | -0.000964197 | -0.001428795 | -0.001893393 | -0.002822590 | -0.004680983 |
| DrbJX | -0.000406220 | -0.000653700 | -0.001272400 | -0.001891100 | -0.002509800 | -0.003747200 | -0.006222000 |
| BhhRQ | +0.000320468 | +0.000554113 | +0.001138227 | +0.001722340 | +0.002306453 | +0.003474680 | +0.005811133 |
| HVEbGM | -0.001925242 | -0.003178735 | -0.006312469 | -0.009446202 | -0.012579935 | -0.018847402 | -0.031382335 |

## Fee efficiency and fee/TVL

Durably derivable active-time fee efficiency is:

- Bhh: 0.000350653 SOL fees / (0.03 SOL × 0.682 active hours) = **1.71% of
  capital per active hour**.
- HVE: 0.000924642 SOL fees / (0.03 SOL × 5.519 active hours) = **0.559% of
  capital per active hour**.

Active time is unavailable for the other five settled lifecycles, so an actual
fee-per-active-capital-hour measure cannot be honestly calculated for them.
Historical decision-time pool fee/TVL snapshots are unavailable in the settled
cohort, so no look-ahead-safe comparison to pool fee/TVL is made. Current UI or
current pool values were not substituted.

## Scalable, fixed, and unknown components

- **Scalable assumption:** LP fees and the inventory/unwind residual scale with
  deployed capital at constant share and identical price path.
- **Fixed assumption:** observed transaction/priority fees remain constant.
- **Unknown/nonlinear:** ownership share, bin liquidity, route price impact,
  slippage, token conversion, fee share, active-time changes, range capacity,
  and market response. These can make larger-capital reality worse or better;
  this forensic does not estimate them.

## Conclusion

0.03 SOL has real but modest fixed-cost drag. It is **not** the dominant cause
of the corrected cohort loss and is not below the break-even size for the two
positive scalable lifecycles. Increasing capital would reduce percentage
overhead but would also scale the same adverse inventory economics. The data
does not support treating a larger allocation as a remedy for weak economics.
