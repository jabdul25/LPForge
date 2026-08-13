# LPForge Phase 1 — Codex Deployment / Evidence Prompt

You are deploying an already-implemented LPForge Phase 1 read-only foundation. **Do not redesign it and do not add trading or signing functionality.**

1. Read `README.md`, `docs/implementation/PHASE1_BUILD_STATUS.md`, `docs/evidence/phase1-evidence.md`, the authoritative architecture docs, and `SECURITY_PHASE1.md`.
2. Confirm Node 24.x LTS. Enable Corepack and use the pinned pnpm major/version in `package.json`.
3. Run `pnpm install`. If this release artifact has no `pnpm-lock.yaml`, generate it once on this connected host, review it, commit/archive it, then all subsequent installs use `--frozen-lockfile`.
4. Copy `.env.example` to `.env`. Set `DATABASE_URL`, a reliable Solana RPC URL, and keep `LIVE_SIGNING=false`. Do not add wallet secrets.
5. Start PostgreSQL 17 and run: `pnpm typecheck`, `pnpm build`, `pnpm test:ci`, `pnpm db:migrate`, then `pnpm db:migrate` again.
6. Run fixture proof: `pnpm phase1:fixture`.
7. Set `LPFORGE_DATA_MODE=LIVE_READ_ONLY`. Use `pnpm observer -- data-api-pools 1 10` to select a current Meteora DLMM pool and set it as `LPFORGE_SMOKE_POOL_ADDRESS`.
8. Run `pnpm observer -- protocol-verify` and `pnpm observer -- pool-inspect <pool>`.
9. Run `pnpm observer -- data-api-ohlcv <pool>`.
10. Run `pnpm observer -- event-scan <pool> 20`; capture whether current `Swap2Evt` decoding succeeds. A decoder mismatch is `PROTOCOL_COMPATIBILITY_HOLD`, not permission to guess fields.
11. If a known PositionV2 address is available, run `pnpm observer -- position-inspect <pool> <position>`.
12. Start API and verify `/health/live`, `/health/ready`, `/api/v1/capabilities`, and that POST is rejected.
13. Update `docs/evidence/phase1-evidence.md` with exact commands/results. Report: files changed (ideally evidence/lockfile only), migrations applied, tests, live reads, event decoder result, remaining blockers.

**Prohibited:** private keys, seed phrases, transaction signing/sending, pool scoring, entry logic, RangeForge, rebalance/claim/swap, Phase 2 code.
