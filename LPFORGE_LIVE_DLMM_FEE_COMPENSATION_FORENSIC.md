# Live DLMM fee-compensation / inventory-PnL forensic

Status: `COMPLETE — evidence-qualified, position remains open`  
Forensic cutoff: chain position read at `2026-08-31T16:30:04.045Z`; fresh
active-bin read at `2026-08-31T16:31:26.004Z`; Meteora Data API valuation read
at `2026-08-31T16:32:29.363Z`.

## Executive finding

The position exhibits the expected DLMM inventory mechanics: its upward move
from entry converted NEEGY into SOL and earned fees; its subsequent reversal
converted the inventory back toward NEEGY.  The latter conversion was not
fully paid for.  From the last **durably reconstructable** peak to the current
chain read, inventory value fell by `0.000961169 SOL`, while incremental
position-specific gross fees were `0.000484598 SOL`.  The resulting fee
compensation ratio is **50.42%** before any hypothetical future fees.

This is neither evidence that DLMM is mechanically broken nor evidence of a
healthy fully fee-compensated cycle.  The supported classification is
`PARTIALLY_COMPENSATED_INVENTORY_RISK`.

The economic conclusion is limited by a material observability gap: durable
position observations and decoded pool events stop at 13:49 UTC while direct
chain reads show the position still exists and is back in range after that
time.  No screenshot value is used as accounting truth.

## Position identity and construction

| Field | Value |
|---|---|
| Position | `HVEbGMQx9xW1yDmo9zgpzNyFQXt6W4YqR3uPTxbNNZtp` |
| LPForge lifecycle | `lifecycle:HVEbGM...NZtp` |
| Pool | `EsR3gRxMtqt3bBhDDsuY3SFyYNYvYzszzG9KVYpcQfs7` (NEEGY / WSOL) |
| Entry | `2026-08-31 13:04:46.144 UTC` |
| Strategy / orientation | `BID_ASK / SKEWED_Y` |
| Range / entry bin | `-578..-568` / `-571` |
| Position capital | `30,000,000` lamports (`0.03 SOL`) |
| Native LP funding | `20,055,295` lamports |
| Protected paired-token funding | `9,944,705` lamports, `33.14%` target |
| Measured token residual | `124,929,237` NEEGY raw; attributed to this lifecycle |

The measured residual is included in the mark-to-market calculations.  It is
position-attributable inventory, not an unrelated wallet balance.

## Current reconciled state

Direct Meteora SDK evidence showed at the forensic cutoff:

| Field | Value |
|---|---:|
| Chain active bin | `-574` |
| Current range state | `IN_RANGE` |
| Position NEEGY | `4,448.338182` |
| Attributed residual NEEGY | `124.929237` |
| Total lifecycle NEEGY used for valuation | `4,573.267419` |
| Position WSOL | `0.014485219 SOL` |
| Claimable WSOL fee | `0.000539022 SOL` |
| Fees already claimed for this lifecycle | `0.000122976 SOL` |
| Cumulative gross LP fees | `0.000661998 SOL` |
| Attributed transaction costs | `0.000020000 SOL` |
| Current NEEGY/SOL price | `0.000003225194 SOL` |
| Current inventory value | `0.029234893 SOL` |
| Current net managed value | `0.029876891 SOL` |
| Current mark-to-market PnL | `-0.000123109 SOL` (`-0.4104%`) |
| Holding time at chain read | `3h 25m 18s` |

No terminal settlement, inventory-unwind PnL, or M0063 terminal fee
attribution exists because the position remains open.

The database's last management observation is stale (`2026-08-31 13:49:21
UTC`) and says `OUT_OF_RANGE` at bin `-567`; the current chain read at `-574`
supersedes that snapshot.  The current continuous OOR duration is therefore
zero.  A previous upper-OOR excursion is bounded by the 5-minute candles as
approximately 21–26 minutes (13:49 UTC until re-entry between 14:10 and
14:15), but it was not durably closed as an excursion because monitoring
stopped.

## Economic path and bin traversal

The following are the finest fully reconcilable landmarks.  Values include the
attributed opening NEEGY residual, realized fee cashflows, unclaimed fees, and
attributable chain-receipt costs.

| Time (UTC) | Bin | State | NEEGY incl. residual | WSOL | Cumulative fees | Net value (SOL) | Return |
|---|---:|---|---:|---:|---:|---:|---:|
| 13:05:29 | -571 | in range | 2,933.258 | 0.019959 | 0 | 0.029889 | -0.37% |
| 13:20:00–13:21:23 | -570 | in range | 2,435.860 | 0.021670 | 0.000031554 | ~0.03019 | ~+0.63% |
| 13:37:49 | -568 | in range | 965.609 | 0.026803 | 0.000122976 | 0.030294 | +0.98% |
| 13:49:05 | -568 | in range | 124.929 | 0.029755 | 0.000177400 | 0.030353 | +1.18% |
| 13:49:22 | -567 | above range | 124.929 | 0.029755 | 0.000177400 | 0.030353 | +1.18% |
| 16:30–16:32 | -574 | in range | 4,573.267 | 0.014485 | 0.000661998 | 0.029877 | -0.41% |

The prior operator UI peak of approximately `+2.31%` is not reproducible from
durable LPForge/on-chain observations.  The highest durable managed-NAV
high-water point is `+1.1991%` in the management payload at 13:49 UTC; the
reconstructed value above is `+1.1782%`, with the small difference explained
by timestamp/price-source granularity.  This report uses the durable peak,
not the screenshot.

### Decoded productive traversal before the peak

Five decoded swaps exist from entry through 13:40 UTC.  The material upward
traversal was `-571 → -570 → -568`; it reduced position NEEGY, increased WSOL,
and generated the first `0.000122976 SOL` of fees (including the two claimed
cashflows).  This is a productive DLMM traversal.

### Adverse traversal after the peak

From the durable peak at bin `-568` to the current in-range bin `-574`:

| Metric | Change |
|---|---:|
| Direction / bins | down 6 bins |
| Lifecycle NEEGY value share | 1.46% → 50.45% |
| Inventory value | `0.030196062` → `0.029234893 SOL` |
| Inventory deterioration | `-0.000961169 SOL` |
| Incremental gross fees | `+0.000484598 SOL` |
| Incremental attributed costs | `0 SOL` proven after the peak (the expired claim has no recorded cost) |
| Net value change | `-0.000476571 SOL` |
| Fee compensation ratio | `50.42%` |

The broad conclusion is that fee capture materially cushioned the conversion,
but did not neutralize it.  Per-bin post-peak swap flow cannot be reconstructed:
decoded event persistence ends at 13:40 UTC, before the complete reversal.

## Fees, forecast, and flow

### Fee efficiency

* Gross fees: `0.000661998 SOL`, or `2.207%` of the 0.03-SOL capital.
* Full elapsed-capital-hour fee rate: about `0.642%` per capital-hour over the
  3.43-hour holding interval.
* The last known OOR excursion is bounded to roughly 21–26 minutes.  If that
  bound is used, active-capital-hour fee rate is approximately `0.72–0.74%`.
  This is an estimate, not a durable active-time counter.
* Current Data API evidence has `30m fees = 0`, while 1h pool fee/TVL is
  `0.01235` percentage points.  It does not establish current active-bin flow
  through this position.

### Event-path forecast validation

The frozen entry thesis used `EVENT_PATH_ESTIMATE` (not aggregate fallback):

| Entry forecast, 60m horizon | Value |
|---|---:|
| Candidate expected gross fees | `0.000089550 SOL` |
| Candidate expected inventory PnL | `-0.000017004 SOL` |
| Candidate expected net EV | `0.000062545 SOL` |
| Risk-adjusted net EV in thesis | `0.000019070 SOL` |
| Economic-estimate fee rate | `0.000067203` per capital-hour |

At 44 minutes (the last durable observation), cumulative actual fees were
`0.000177400 SOL`: nearly 2x the full 60-minute fee forecast, while managed
net was approximately `-0.000087 SOL`.  By the current chain read, cumulative
fees are 7.39x the original 60-minute gross-fee estimate, but that comparison
spans 3.43 hours and is not a same-horizon calibration test.  On a
time-normalized basis, actual gross fee rate has been roughly 2.1–2.5x the
entry estimate.

Thus the evidence does **not** support a claim that the event-path model
overstated fees.  It does show that positive fee realization alone did not
guarantee positive net PnL because post-peak inventory conversion was larger.
One position is insufficient to retune event-path calibration.

### Flow classification

`INSUFFICIENT_EVIDENCE` overall; early traversal was fee-producing, while the
post-peak detailed event stream is absent and the current 30-minute pool
metric is zero.  The available data cannot prove either high-flow fee-rich or
toxic low-flow behavior for the entire adverse leg.

## Recovery requirement

These counterfactuals hold the current quantities, accrued/claimed fees, and
recorded costs fixed.  They assume no additional fee accrual and change only
the NEEGY price.

| Target | Required NEEGY/SOL rebound from current | Estimated net return |
|---|---:|---:|
| Current price | — | -0.41% |
| +1% position return | +2.87% | +1.00% |
| +2% position return | +4.90% | +2.00% |
| Durable prior MFE (+1.18%) | +3.23% | +1.18% |
| Screenshot sensitivity: +2.31% | +5.51% | +2.31% |

A modest rebound can therefore recover the current mark-to-market result;
however, the position is not fee-compensated enough to make that recovery
independent of price direction.

## Management evidence at the durable peak

At 13:37–13:49 UTC, the management action was `CLAIM`, not close.  Its reason
code was `EXIT_HOLD_WITH_ECONOMIC_EVIDENCE`, but
`valid_continuation_evidence=false` and no position continuation EV was
persisted.  The third claim plan (`plan-c92de...`) is `RECOVERING` after a
submitted signature reached `EXPIRED` with an unknown economic effect.  That
pending plan left the OOR state as `HOLD_CHAIN_RECONCILIATION` and prevents a
fresh durable management sequence.

Classification at the MFE is therefore `INSUFFICIENT_EVIDENCE`, not
`RATIONAL_HOLD` or `MISSED_PROFIT_EXIT`: the system did not persist a usable
forward-economic comparison at the point needed to judge a discretionary
profit exit.

## Conclusion and recommendation

| Question | Finding |
|---|---|
| Current position health | `PARTIALLY_COMPENSATED_INVENTORY_RISK` |
| Is a simple PnL trailing stop justified? | No |
| Is a fee-compensation monitor justified? | Yes |
| Is inventory-risk intelligence justified? | Yes |
| Is event-path recalibration justified? | No — insufficient evidence; fees exceeded forecast |
| Is a range/strategy change justified? | Insufficient evidence |
| Should this position be manually altered? | No; existing lifecycle/risk authority remains controlling |

The smallest evidence-based next improvement is **not** an automatic trailing
profit exit.  It is a persisted fee-compensation/inventory-conversion monitor
that records, at each durable management observation:

1. MFE managed NAV and price;
2. inventory-value deterioration since MFE;
3. gross fees accrued since MFE;
4. fee-compensation ratio;
5. token-exposure change, range state, and active-bin flow provenance; and
6. current forward EV/evidence quality.

That monitor should be paired with restoration of durable management
observations and resolution-aware handling of the expired claim plan, since
the present gap makes the most important adverse traversal unobservable.  It
should initially be research/observability only; this single live outcome does
not justify an autonomous exit threshold.

## Evidence limitations

* No persisted position snapshot exists after 13:49 UTC; direct chain reads
  establish current state but not the intervening path.
* Decoded swap events end at 13:40 UTC.
* The previous OOR re-entry is inferable from 5-minute price candles and the
  current chain bin, but its exact timestamp/duration is not durable.
* Current forward EV is unavailable because management is blocked behind the
  recovering claim plan.
* No final M0065/M0063 settlement accounting exists while the position remains
  open.

No source, policy, database record, runtime configuration, service, or
position state was changed for this forensic.
