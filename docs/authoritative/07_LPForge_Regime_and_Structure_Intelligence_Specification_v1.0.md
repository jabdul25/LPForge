> **Project:** LPForge  
> **Suite Version:** 1.0  
> **Design Baseline Date:** 12 August 2026  
> **Status:** Build-guiding baseline  
> **Scope:** Meteora DLMM liquidity intelligence, decisioning, simulation, execution and operations  
> **Principle:** Protocol truth is observed; trading intelligence is inferred; execution is deterministic.  


# LPForge Regime and Structure Intelligence Specification

## 1. Mission

Describe the market state and likely transition risk without deciding by itself whether to enter.

## 2. Multi-Horizon Design

No single timeframe is authoritative.

Recommended semantic layers:
- **microstructure:** event/1m–5m;
- **entry structure:** 5m–15m;
- **local regime:** 15m–1h;
- **context:** 1h–4h+.

The Data API's supported candles may be complemented with event-derived candles.

## 3. Canonical Regime Classes

Top-level:
- `SIDEWAYS`
- `CONSOLIDATION`
- `CONTROLLED_PULLBACK`
- `BREAKOUT`
- `BREAKOUT_CONTROLLED_PULLBACK`
- `TREND_UP`
- `TREND_DOWN`
- `DISTRIBUTION`
- `EXHAUSTION`
- `FREEFALL`
- `RECOVERY`
- `TRANSITION`
- `UNKNOWN`

Each assessment also includes:
- direction;
- volatility state;
- trend strength;
- structure quality;
- transition probabilities;
- confidence;
- stability duration.

## 4. Why `TRANSITION` Matters

Classification instability is itself information. If the model is rapidly alternating between classes, confidence should fall and RangeForge should prefer wider/less concentrated candidates or `NO_TRADE`.

Never reset all recovery/stability counters simply because a textual label changed. Track continuous underlying features and a regime-state fingerprint.

## 5. Feature Families

### Trend
- multi-horizon returns/slopes;
- moving-average structure;
- Supertrend or equivalent as one feature, not sole authority;
- directional efficiency;
- higher-high/lower-low structure.

### Volatility
- realized volatility;
- ATR normalized by price;
- candle range expansion;
- bin velocity/acceleration;
- dynamic-fee context.

### Compression/expansion
- Bollinger width;
- ATR compression;
- price range compression;
- declining/increasing bin traversal.

### Pullback structure
- distance from impulse high;
- retracement depth;
- retracement speed;
- declining adverse volume;
- support/reclaim behavior;
- bin-velocity deceleration;
- absence/presence of fresh lows.

### Flow
- swap direction;
- two-way ratio;
- local liquidity reaction;
- fees earned during movement;
- large-flow concentration.

## 6. Controlled Pullback

A controlled pullback is not merely “price down after price up.”

Evidence should include:
- preceding validated impulse;
- retracement within structurally acceptable depth;
- decreasing downside velocity;
- no cascading liquidity failure;
- improving two-way flow;
- support or local stabilization;
- absence of freefall fingerprint.

Output:
- `pullback_maturity`;
- `continuation_risk`;
- `recovery_probability`;
- `support_integrity`.

## 7. Breakout-Controlled Pullback

Requires:
1. pre-breakout base/consolidation;
2. breakout with expansion;
3. subsequent retracement toward breakout region;
4. controlled rather than cascading return;
5. evidence of hold/reclaim;
6. acceptable liquidity/flow state.

Do not label the initial post-breakout red candle as the setup.

## 8. Sideways vs Consolidation

`SIDEWAYS`: persistent oscillation without strong compression or directional resolution.

`CONSOLIDATION`: a bounded structure typically showing compression or organized balance after prior movement, with increasing probability of eventual expansion.

The distinction matters because a tight Curve candidate can be reasonable in stable sideways behavior but dangerous immediately before expansion from a compressed consolidation.

## 9. Freefall

Freefall evidence may include:
- accelerating negative returns;
- expanding ranges;
- persistent downward active-bin movement;
- weak revisit/reclaim;
- one-way swap flow;
- liquidity withdrawal/gaps;
- repeated new lows;
- elevated adverse transition probability.

This should be a high-priority block for vulnerable LP shapes.

## 10. Probability Output

Do not output only a label.

Example:

```json
{
  "primary": "CONTROLLED_PULLBACK",
  "probabilities": {
    "CONTROLLED_PULLBACK": 0.62,
    "TREND_DOWN": 0.19,
    "TRANSITION": 0.12,
    "FREEFALL": 0.07
  },
  "stability": 0.74,
  "transition_risk": 0.28
}
```

## 11. Calibration

A 70% recovery probability should empirically recover roughly 70% under the defined event label. Report calibration error by regime and horizon.

## 12. Output Contract

The engine produces context, not `ENTER`.

It must expose:
- regime probabilities;
- structural levels/regions;
- expected volatility;
- likely transition;
- invalidation features;
- data quality.

Opportunity and RangeForge decide what that context is worth.
