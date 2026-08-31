# Aggregate fee-rate percentage-point correction

Status: `COMPLETE`  
Implementation identifier: `aggregate-fee-rate-unit-fix-v1`  
Source before: `c162ab4822fece374169cd8d78beed9052c0f545`

## Executive finding

The aggregate operational economics fallback contained a real unit error.  The
canonical `fee_tvl_ratio` contract is percentage points, while the fallback
used the 1h value as a decimal fractional hourly rate.  Thus a stored `0.02`
(`0.02%`) could be interpreted as `0.02` (2%) instead of `0.0002`.

The correction is deliberately limited to that boundary.  The fresh
event-path calculation, Candidate-Primary, P3/P4/P7, OOR lifecycle, capital
policy, and historical rows are unchanged.

## Unit contract

| Field | Source | Unit | Example | Consumers |
|---|---|---|---|---|
| `fee_tvl_ratio['5m'/'1h'/'6h'/'24h']` | Meteora standard Data API, carried by `DataApiPool` | percentage points | `0.02` = `0.02%` | discovery metrics, discovery/deep-screen scoring, fee features, aggregate operational fallback |
| `CanonicalDiscoveryMetrics.*Fee*TvlRatio*Pct` | `packages/discovery-metrics` | percentage points | `0.5` = `0.5%` | discovery priority and deep screen |
| `feeRatePerCapitalHour` | `OpportunityRateEvidence` / `research.economic_estimates` | decimal fraction per capital-hour | `0.0002` = `0.02%` per hour | opportunity expected-fee calculation and P3 inputs |
| event-path fee rate | `deriveEventPathEconomicEstimate` | decimal fraction per capital-hour, computed from `fees / TVL / hours` | `$20/$100,000 = 0.0002` | production’s fresh economic evidence |

The relevant canonical declaration is `CanonicalDiscoveryMetrics`:
“Every ratio is percentage points: 0.5 means 0.5%, never 0.005.”

## Exact path and fix

```text
evaluateOperationalCycle
  -> fresh EVENT_PATH_ESTIMATE <= 300 seconds?
      yes: deriveEventPathRateEvidence (unchanged)
      no:  deriveAggregateRateEvidence
             fee_tvl_ratio['1h'] percentage points
             -> percentagePointsToFraction(value)
             -> feeRatePerCapitalHour fractional rate
             -> opportunity expected fees / P3 economics
```

`packages/operational-runtime/src/index.ts::deriveAggregateRateEvidence`
previously assigned `pool.fee_tvl_ratio['1h']` directly to the rate.  It now
calls the named, non-negative conversion helper
`packages/discovery-metrics/src/index.ts::percentagePointsToFraction`.

The direct raw-fee fallback (`fees['1h'] / tvl`) was already a fraction and is
unchanged; it is not divided a second time.  Negative/unavailable percentage
point input retains prior safe fallback behaviour.

### Worked regression

```text
capital: 0.03 SOL
stored 1h fee/TVL: 0.02 percentage points = 0.02%
correct fraction: 0.02 / 100 = 0.0002
correct simple hourly fee: 0.03 * 0.0002 = 0.000006 SOL
old interpretation:       0.03 * 0.02   = 0.000600 SOL
overstatement: 100x
```

## Codebase-wide audit

| Area | Classification | Result |
|---|---|---|
| `discovery-metrics` `ratioPct`, canonical fields | `CORRECT_PERCENTAGE_POINT_USE` | Emits and labels percentage points. |
| `pool-discovery` / discovery priority | `CORRECT_PERCENTAGE_POINT_USE` | Uses `*Pct` fields only as bounded score inputs. |
| `pool-deep-screen` fee density | `CORRECT_PERCENTAGE_POINT_USE` | Uses ratios as score-scale values, not economic fractions.  The legacy non-canonical fallback is documented `SOURCE_UNSPECIFIED`, but does not feed `feeRatePerCapitalHour`. |
| `features` / `pool-intelligence` | `CORRECT_PERCENTAGE_POINT_USE` | Exposes ratios for descriptive/persistence features; no economic rate conversion. |
| `active-candidate-evidence` | `CORRECT_EXPLICIT_CONVERSION` | Computes fraction from raw fees / TVL / elapsed hours.  No change. |
| `operational-runtime` event-path branch | `CORRECT_PERCENTAGE_POINT_USE` | Receives an already-fractional event-path rate.  No change. |
| `operational-runtime` aggregate branch | `UNIT_BUG` -> fixed | Now explicitly converts percentage points once. |
| `opportunity` | `CORRECT_FRACTION_USE` | Multiplies capital by fractional hourly fee rate. |
| candidate ranking / calibration / forward outcomes | `CORRECT_FRACTION_USE` | Consume downstream economic values; no direct API percentage-point conversion. |
| discovery-strategy-evaluation research score | `UNIT_AMBIGUOUS`, non-production | Uses deep-screen score-derived synthetic research fee factor, not API fee/TVL as a rate.  Not changed in this narrow correction. |

## Production reachability and blast radius

The fallback remains code-reachable in non-automatic/observation evaluation.
For automatic production capital, `evaluateOperationalCycle` fails closed when
fresh event-path evidence is absent; it returns warming before a fallback rate
can become an entry-authoritative decision.

Production database lineage proves:

* 16,100 frozen Phase-3 decisions: 16,100 `EVENT_PATH_ESTIMATE`, **0**
  `AGGREGATE_ESTIMATE`, 0 unknown.
* 5,773 `ENTRY_READY` decisions therefore used event-path evidence.
* economic-estimate storage contains 2,898 aggregate estimates and 45,747
  event-path estimates, but the aggregate rows were not consumed by a frozen
  production decision.
* 0 executed owned positions join to an aggregate-fallback decision.
* Canary #4 used `EVENT_PATH_ESTIMATE`; current live position also used it.

Counterfactual corrected replay therefore has zero affected persisted
production decisions: 0 unchanged-row recalculations required, 0
`ENTRY_READY -> NO_TRADE`, 0 `NO_TRADE -> ENTRY_READY`, 0 strategy/range
changes, and 0 EV-sign changes.  Historical rows were not rewritten.

## Verification

Focused tests cover percentage-point conversion (`0.02`, `0.5`, `1.0`, zero,
unavailable, negative), the exact 100x 0.03-SOL example, raw-fees/TVL
no-double-conversion, and unchanged event-path output.  Candidate-primary,
fee-calibration, OOR, and existing operational tests were included in the
focused run.

`pnpm test:ci` passed before release packaging.  No migration is required:
stored discovery metrics are already correctly percentage-point values, and
no historical value was altered.

## Deployment and runtime verification

The immutable production artifact for source
`394bd546365f06e00429243a8355b54bb94717f6` passed runtime release identity
verification with build identity
`18a0dc432b8bb82ee43cf4f840bf2807e653d600d37c38fa4b19a3b293bcf927` and the
unchanged M0065 migration head.  Only `lpforge-production` was reloaded;
`lpforge-execution`, discovery, and discovery-learning were not restarted.

Post-deploy, production is online without restarts and the verified runtime
identity is the corrected source commit.  P7 reports `PRODUCTION / HEALTHY`.
There is one pre-existing active position, zero reserved lamports, zero UNKNOWN
submissions, and zero unresolved reconciliation debt.  Its existing lifecycle
was not altered.  Execution remains online with its normal autonomous signer,
sign, submit, close, and recovery paths available; no transaction was manually
sent for this correction.

The current automatic-capital entry path still requires fresh event-path
evidence and does not promote aggregate fallback economics into an
entry-authoritative decision.  No safe live aggregate-fallback example existed
to force during verification, so the conversion boundary was exercised through
the deterministic regression fixture rather than by altering live conditions.

## Scope preserved

* Fee-productivity admission remains `HOLD_INSUFFICIENT_FEE_THRESHOLD_EVIDENCE`.
* No candidate fee-credibility/admission policy was added.
* No active position was altered; this fix is not a retroactive close signal.
