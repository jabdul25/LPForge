# Protocol Compatibility Baseline — 12 August 2026

Authoritative references:
- https://docs.meteora.ag/developer-guides/dlmm/changelog
- https://docs.meteora.ag/developer-guides/dlmm/typescript-sdk/reference
- https://docs.meteora.ag/developer-guides/dlmm/program/accounts
- https://docs.meteora.ag/developer-guides/dlmm/program/events
- https://docs.meteora.ag/developer-guides/dlmm/api-reference/overview

Baseline:
- DLMM program `lb_clmm` release: 0.12.0.
- TypeScript SDK: `@meteora-ag/dlmm` 1.9.8.
- Program ID mainnet/devnet: `LBUZKhRxPF3XUpBCjp4YzTKgLccjZhTSDM9YuVaPwxo`.
- `MAX_BIN_PER_ARRAY`: 70.
- base `PositionV2` inline bins: 70; dynamic position maximum is handled by current SDK constants and must be rechecked at live-execution phase.
- `FunctionType`: undetermined / liquidity mining / limit order.
- `CollectFeeMode`: input only / only Y.
- Data API production base: `https://dlmm.datapi.meteora.ag`; rate limit: 30 RPS.
- Data API list query uses `page`, `page_size` (pool list up to 1000), and supports current documented rolling windows.

The runtime `protocol-verify` command must be run on the deployment host after dependencies are installed and before live-read collection is considered verified.
