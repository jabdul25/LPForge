> **Project:** LPForge  
> **Suite Version:** 1.0  
> **Design Baseline Date:** 12 August 2026  
> **Status:** Build-guiding baseline  
> **Scope:** Meteora DLMM liquidity intelligence, decisioning, simulation, execution and operations  
> **Principle:** Protocol truth is observed; trading intelligence is inferred; execution is deterministic.  


# LPForge Market Data, Indexing and Feature Spine

## 1. Objective

Produce a reproducible, low-latency factual substrate from which every LPForge intelligence decision can be regenerated.

## 2. Source Hierarchy

### A. Direct Solana/Meteora program data
Use for:
- real-time swaps;
- active-bin transitions;
- liquidity changes;
- position state;
- fee/reward claims;
- rebalance events;
- pool configuration.

Preferred rich swap event: `Swap2Evt`.

### B. Meteora DLMM Data API
Use for:
- discovery;
- aggregate volume/fee/fee-TVL windows;
- pool metadata;
- portfolio cross-checks;
- OHLCV backfill;
- historical volume.

The API is rate-limited; all calls pass through a central rate limiter/cache.

### C. External reference market
Use for:
- pool-vs-market divergence;
- SOL/USD numeraire conversion;
- cross-venue sanity.

### D. Risk/enrichment
Optional adapters may ingest Organic Score, token authority, holder/concentration and other risk signals. Each signal carries source and freshness.

## 3. Event Ingestion

For every observed transaction:
1. record slot/signature;
2. parse relevant Meteora event CPI;
3. deduplicate by signature/event index;
4. persist raw normalized event;
5. update event watermark;
6. enqueue feature invalidation;
7. reconcile important account state periodically.

Do not treat websocket delivery as exactly-once. Backfill gaps by slot/signature.

## 4. Required Event Families

- `LbPairCreate`
- `PositionCreate` / `PositionClose`
- position resize/operator events
- `AddLiquidity`
- `RemoveLiquidity`
- `CompositionFee`
- `Rebalancing`
- `Swap2Evt` (plus compatibility parsing)
- `ClaimFee2`
- reward events
- fee parameter changes
- dynamic fee parameter changes
- limit-order events for pools where relevant.

## 5. Time Model

Every record carries where applicable:
- `chain_slot`;
- `chain_block_time`;
- `source_timestamp`;
- `observed_at`;
- `processed_at`.

Features must not accidentally use information observed after the decision time during replay.

## 6. Candle Construction

Meteora Data API provides fixed OHLCV windows useful for backfill and verification. LPForge should additionally create event-derived:
- 1m;
- 5m;
- 15m;
- 30m;
- 1h;
- 4h

candles from swap events where sufficient data exists.

Keep API candles and event-derived candles distinguishable. Differences are a data-quality signal.

## 7. Bin-Native Features

### Active-bin movement
- net bin movement;
- absolute bins crossed;
- bin velocity;
- acceleration;
- direction changes;
- time per active bin;
- return-to-bin frequency.

### Local liquidity
For configurable windows around active bin:
- total MM liquidity;
- token composition;
- liquidity density;
- skew;
- empty-bin gaps;
- edge cliffs;
- concentration entropy.

### Swap flow
- buy/sell notional;
- two-way ratio;
- directional persistence;
- average bins crossed per swap;
- large-swap concentration;
- unique wallet activity where legally/technically available;
- fee generated per unit bin movement.

### Fee quality
- MM fees by horizon;
- dynamic/base fee share;
- fee/TVL;
- **fee/local-active-liquidity**;
- fee persistence;
- fee burstiness;
- fee decay after volatility spike.

## 8. Range-Outcome Features

For candidate widths `W` and horizon `H`:
- historical probability active bin stays inside;
- first-passage time to lower/upper boundary;
- revisit probability after exit;
- number of boundary touches;
- expected active-time percentage.

These must be computed without future leakage.

## 9. Data Quality

Each feature vector stores:
- source completeness;
- latest slot;
- missing fields;
- stale fields;
- discrepancy flags;
- event-gap flags;
- reference-price age.

Decision policy may require `DATA_QUALITY = GOOD`; degraded data can support monitoring but not entry.

## 10. Backfill

Backfill jobs are deterministic and checkpointed:
- pools;
- API aggregates;
- OHLCV;
- transaction/event windows when available;
- account snapshots.

Feature regeneration writes a new feature-version partition rather than modifying historical inference inputs.

## 11. Retention

Keep permanently:
- decisions;
- executions;
- position/accounting events;
- policy versions;
- forensic episodes.

High-frequency raw bin snapshots may be tiered:
- hot PostgreSQL;
- compressed partitions;
- Parquet/object archive.

## 12. Acceptance Criteria

The data spine is not considered complete until:
- duplicate event processing is harmless;
- restart from checkpoint loses no committed event;
- gap detection works;
- feature recomputation from raw events is deterministic;
- replay at timestamp T cannot see observations from T+1;
- open-position accounting can be reconstructed independently from transaction history and reconciled on-chain.
