# LPForge Range Width / OOR / Exit Forensic V2

Status: PARTIALLY_CONFIRMED (read-only; 2026-09-04)

## Scope

No production range, P4, stop-loss, configuration, or trading-policy change was made.

## DOGE-1 authoritative reconstruction

| Fact | Value |
| --- | --- |
| Entry plan / position | `plan-fa11a94c1955baf48a451b66b7c2c11a` / `7z3YCFnYGN27nuQQXL58U5Li9qc3PmRSKZyvLNmbEtA4` |
| Opened | 2026-09-04T09:48:50.590Z |
| Strategy / orientation | CURVE / SKEWED_Y |
| Bin step | 80 (0.8% per bin) |
| Entry active bin | -1538 |
| Range | -1550 through -1534, 17 included bins |
| Downside / upside bin buffer | 12 / 4 bins |
| Geometric downside / upside buffer | -9.12% / +3.24% |
| Full geometric width | 13.69% |
| P4 immediate-OOR score / gate | 0.1313 / 0.65 |
| Planned = recorded on-chain geometry | Yes |
| P3/P4 horizon | 60 minutes |

The position was therefore already intentionally downside-skewed.  It was not a symmetric 17-bin range, but its effective downside buffer was still only 12 bins.

## DOGE-1 observed path

* First lower-edge/OOR observation: 2026-09-04T09:58:27.799Z, active bin -1551 — 9m 35s after entry.
* The monitored low was bin -1561: 11 bins below the lower boundary and 23 bins below entry (about -16.7% from entry by bin geometry).
* Stop-loss decision observation: 2026-09-04T10:25:32.104Z at bin -1557.
* Exit was `EXIT_HARD_POSITION_STOP_LOSS`, not an automatic OOR exit.
* At the stop observation the complete-NAV return was -13.28%; the hard-stop threshold is -12%.  Gross fee value at that point was about $0.0417.
* Inventory at the stop observation was 100% token / 0% SOL according to the durable management metric.  That is consistent with a downside OOR conversion into DOGE exposure.
* Liquidity-removal/close workflow began at 10:29Z.  The observed active bin re-entered the former range at 10:54:45Z — about 25m 44s after the exit decision.

The exit governor uses complete managed NAV: contributions, in-position assets, attributable wallet inventory, realized withdrawals/fees, and execution costs.  It does not use an OOR flag as the direct hard-stop trigger.  Fees are included, and the hard stop is 12%; emergency stop is 20%.

## Geometry-only counterfactual

These are exact range-boundary replays against observed bins, not fabricated fee/PnL simulations.

| Width | Geometry (SKEWED_Y) | Lower / upper | Result against observed low -1561 |
| --- | --- | --- | --- |
| Actual 1.00x | 17 bins, 12-down / 4-up | -1550 / -1534 | OOR |
| 1.25x | 21 bins, 14-down / 6-up | -1552 / -1532 | OOR |
| 1.50x | 25 bins, 17-down / 7-up | -1555 / -1531 | OOR |
| 2.00x | 35 bins, 24-down / 10-up | -1562 / -1528 | remains in range |

At the actual stop bin (-1557), only the 2.00x geometry would have remained in range.  Holding capital and liquidity distribution otherwise fixed, geometric liquidity concentration is approximately 80%, 68%, and 49% of the 17-bin concentration for the 1.25x, 1.50x, and 2.00x cases respectively.  This is not a fee forecast: the historical journal does not contain sufficient per-bin fee attribution to truthfully estimate counterfactual fees or NAV.

## Aug 29–31 cohort

There are eight distinct production lifecycles in the period, with widths of 11, 15, 17, and 99 bins.  Three have an authoritative recorded OOR episode; two subsequently re-entered their original range.

| Plan | Width | First OOR | Re-entry | Exit state |
| --- | ---: | --- | --- | --- |
| `plan-51353…` | 11 | 2m 21s | 14m 41s after entry | hold / settled positive |
| `plan-3ad1fd…` | 11 | 44m 35s | none recorded | hold |
| `plan-b9137…` | 15 | 60m 37s | 77m 34s after entry | hold |
| Other five | 11, 11, 11, 17, 99 | no OOR record | n/a | mixed non-OOR exits |

The 99-bin position also had a severe exit without a recorded OOR episode.  Therefore the cohort does **not** support a claim that narrow width alone explains every loss or exit.  It does support that 11–17 bin geometries can OOR rapidly and can subsequently reclaim.

## Current policy facts

* Range generator minimum width: 11 bins; maximum production construction width: 100 bins.
* Width is volatility/range-history derived, then multiplied by family: NARROW 0.75, BASE 1.0, WIDE 1.4, DEFENSIVE 1.9.
* The selected candidate can still be NARROW; DOGE-1 selected `narrow-17-9-7` before SKEWED_Y geometry widened downside to 12 bins.
* P3/P4 horizon for DOGE-1 was explicitly 60 minutes.  Actual time to first OOR was 9m 35s.
* The current P4 immediate-OOR score materially underestimated this realized path (0.131 vs the 0.65 WAIT gate).  That establishes a calibration/survival-horizon question, not proof that the P4 gate should simply be loosened or tightened.

## Conclusion and recommended next experiment

The live DOGE-1 case confirms `RANGE_SURVIVAL_HORIZON_TOO_SHORT`, `DOWNSIDE_BUFFER_INSUFFICIENT`, and `STOP_LOSS_INTERACTION_AMPLIFIES_OOR` for that entry.  The broader historical claim is only partially confirmed because the cohort is small, heterogeneous, and includes non-OOR exits.

Before changing production, implement a deterministic replay that values each candidate's actual bin distribution and fee path at each observed bin.  The candidate rule to evaluate is: select the narrowest eligible geometry whose downside survival covers the configured horizon at the target survival confidence; reject the trade if the resulting width makes net EV non-positive.  For DOGE-1, the observed-path floor would have been at least 35 bins / 24 downside bins; whether that was economically acceptable cannot be asserted without the missing fee-attribution replay.
