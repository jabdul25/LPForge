# LPForge Range Width Derivation + Family Amplification Fix V1

Implementation ID: `bounded-displacement-single-resolved-range-width-v1`

## Corrected contract

Production resolves one inclusive range width:

`max(policy.range.minimumIncludedBins, volatilityRequiredWidthBins, survivalHorizonRequiredWidthBins)`.

The configured policy remains 35 minimum included bins and 100 maximum included bins.  A width above 100 is rejected only when that resolved contract exceeds 100.  Range-family labels remain available as strategy/distribution choices, but never multiply a resolved production width.

## Root cause and repair

- `absoluteBins` remains telemetry only.  `MarketContext` now records `maxAnchorDisplacementBins`, the largest bounded movement from the first in-horizon bin.  Reversal-heavy movement can no longer inflate width through cumulative path length.
- Volatility width uses the bounded excursion envelope with the existing horizon, regime, and volatility modifiers.
- Survival width uses directional net displacement projected to the declared horizon.  It no longer reads cumulative `absoluteBins` or `binVelocityPerMinute` in current production snapshots.
- Production family construction uses the one resolved width for NARROW, BASE, WIDE, and DEFENSIVE.  Asymmetry redistributes lower/upper bins while retaining the exact inclusive total.
- Compatibility fallbacks apply only to legacy immutable fixtures which predate the new context field; current collector snapshots always carry the bounded field.

## Deterministic controls

- Choppy path `0 -> 20 -> 2 -> 22 -> 4 -> 21`: cumulative travel is retained as 93 bins of telemetry while bounded excursion is 22 bins.
- Trending path to -40 bins retains a wider requirement than the choppy 22-bin excursion.
- A resolved 65-bin candidate, including DEFENSIVE, remains 65 bins rather than being expanded above the cap.
- Skewed X/Y geometry preserves its resolved inclusive width.
- Resolver controls cover 35-bin floor, mid-zone 72-bin result, true 112-bin cap rejection, and bin steps 50/80/100/125.

## Validation

- Focused range/Phase 3/Phase 4 suite: 30/30 passing.
- Full canonical CI: 983/983 passing, all phase and migration boundary checks passing.
- No policy thresholds, stop loss, capital cap, position cap, P4 thresholds, P6, settlement, signing, or RPC settings changed.

## Live validation

The former false path `resolved safe width <= 100 -> optional family expansion > 100 -> RANGE_REQUIRED_WIDTH_EXCEEDS_MAXIMUM` is eliminated by deterministic production-mode replay.  Fresh live decisions remain the normal non-forced confirmation path after deployment.
