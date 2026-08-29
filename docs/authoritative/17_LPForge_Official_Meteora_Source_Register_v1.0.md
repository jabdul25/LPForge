> **Project:** LPForge  
> **Suite Version:** 1.0  
> **Design Baseline Date:** 12 August 2026  
> **Status:** Build-guiding baseline  
> **Scope:** Meteora DLMM liquidity intelligence, decisioning, simulation, execution and operations  
> **Principle:** Protocol truth is observed; trading intelligence is inferred; execution is deterministic.  


# LPForge Official Meteora Source Register

## 1. Review Scope

This source register records the official Meteora material reviewed for the LPForge v1.0 design baseline. Protocol-specific claims in the suite should be revalidated against these sources and the current on-chain program before production deployment.

## 2. Official Sources

### Meteora documentation index
https://docs.meteora.ag/llms.txt

Use: discover current product/developer pages.

### What is DLMM?
https://docs.meteora.ag/core-products/dlmm/what-is-dlmm

Key design facts:
- discrete price bins;
- one active bin;
- Spot/Curve/Bid-Ask;
- dynamic fees;
- function modes;
- bin step;
- dynamic position support.

### DLMM Dynamic Positions
https://docs.meteora.ag/core-products/dlmm/dynamic-positions

Key design facts:
- `PositionV2`;
- default per-bin layout;
- dynamic expansion;
- maximum 1,400-bin range;
- fee/reward accounting;
- operators;
- range resizing/rebalance behavior.

### DLMM Strategies and Use Cases
https://docs.meteora.ag/core-products/dlmm/strategies-and-use-cases

Key design facts:
- Spot/Curve/BidAsk semantics;
- narrow/wide trade-offs;
- single-sided DCA use cases;
- bin-step relationship to price coverage.

### DLMM Collect Fee Mode
https://docs.meteora.ag/core-products/dlmm/collect-fee-mode

Key design facts:
- `InputOnly`;
- `OnlyY`;
- fee denomination affects LP economics.

### DLMM Liquidity Mining
https://docs.meteora.ag/core-products/dlmm/liquidity-mining

Key design facts:
- active/crossed liquidity reward behavior;
- two reward slots;
- out-of-range liquidity does not earn;
- rewards do not auto-compound.

### DLMM Formulas
https://docs.meteora.ag/core-products/dlmm/formulas

Key design facts:
- bin price relationship;
- Q64.64/fixed-point considerations;
- base + variable fee;
- maximum fee;
- fee splits;
- composition fee;
- reward and swap math.

### DLMM Program Accounts
https://docs.meteora.ag/developer-guides/dlmm/program/accounts

Key design facts:
- LbPair;
- BinArray of 70 bins;
- Bin fee/liquidity state;
- PositionV2 layout;
- bitmap extension.

### DLMM Program Instructions
https://docs.meteora.ag/developer-guides/dlmm/program/instructions

Key design facts:
- current v2 position/liquidity/swap flows;
- `rebalance_liquidity`;
- claims;
- position resize;
- limit orders.

### DLMM Program Events
https://docs.meteora.ag/developer-guides/dlmm/program/events

Key design facts:
- event-CPI indexing;
- `Swap2Evt`;
- `CompositionFee`;
- `Rebalancing`;
- fee/reward events;
- indexer guidance.

### DLMM Program Errors
https://docs.meteora.ag/developer-guides/dlmm/program/errors

Use:
- map Anchor program failures to internal execution reason codes.

### DLMM TypeScript SDK Reference
https://docs.meteora.ag/developer-guides/dlmm/typescript-sdk/reference

Key integration facts:
- active-bin/bin reads;
- positions;
- fee/reward claims;
- oracle/TWAP;
- range extension;
- rebalance simulation/builders;
- cost quotes;
- error handling.

### DLMM Changelog
https://docs.meteora.ag/developer-guides/dlmm/changelog

Key compatibility fact:
- protocol/SDK releases can introduce breaking swap/event/account changes.
- LPForge must pin and verify compatibility and monitor this source.

### DLMM Data API Overview
https://docs.meteora.ag/developer-guides/dlmm/api-reference/overview

Key design facts:
- production API;
- 30 RPS limit;
- pool/portfolio/position/stats endpoints;
- supported aggregate windows.

### Pools endpoint
https://docs.meteora.ag/api-reference/dlmm/pools/pools

Key available data:
- TVL;
- volume windows;
- fee windows;
- fee/TVL windows;
- dynamic fee;
- bin step;
- collect fee mode;
- token metadata/risk-relevant fields.

### OHLCV endpoint
https://docs.meteora.ag/api-reference/dlmm/pools/ohlcv

Use:
- official candle backfill/cross-check for supported windows.

### DLMM Dynamic Terminal
https://docs.meteora.ag/user-guides/how-to-use-dlmm/dynamic-terminal

Key product observations:
- official LP workflow;
- local pool/token risk metrics;
- price/reference mismatch warning;
- single-sided liquidity;
- strategy/range controls;
- position management.

### TradingView Charts
https://docs.meteora.ag/user-guides/how-to-use-dlmm/tradingview-charts

Key design observation:
- Meteora itself frames range selection, entry timing, consolidation, volatility and management as important LP decisions.

### Staying Safe
https://docs.meteora.ag/user-guides/staying-safe-on-meteora

Key design observations:
- token-risk warnings;
- freeze authority;
- JupShield/RugCheck/Organic Score concepts;
- due-diligence requirements.

## 3. Compatibility Rule

Before any live deployment, rerun a source/SDK/program compatibility review. The date in this document is a design baseline, not a promise that protocol interfaces will remain unchanged.

## 4. External Sources

Third-party providers may be added for reference prices and token-risk enrichment. They must have their own source register and cannot silently redefine Meteora protocol facts.
