# Phase 1 Deployment / Verification Runbook

1. Install Node 24 LTS and Corepack.
2. `corepack enable && pnpm install` and commit the generated `pnpm-lock.yaml` before treating P1-01 as production-frozen.
3. Start PostgreSQL 17 using `infra/compose/docker-compose.dev.yml` or managed PostgreSQL.
4. Copy `.env.example` to `.env`; set real RPC URL and database URL. Leave `LIVE_SIGNING=false`.
5. `pnpm typecheck && pnpm build && pnpm test:ci`.
6. `pnpm db:migrate` against a blank database; rerun to demonstrate idempotency/checksum behavior.
7. Set `LPFORGE_DATA_MODE=LIVE_READ_ONLY` and a known Meteora pool address.
8. Run `pnpm observer -- protocol-verify` and `pnpm observer -- pool-inspect <pool>`.
9. If a known PositionV2 is available, run `pnpm observer -- position-inspect <pool> <position>`.
10. Start `pnpm api`; verify `/health/live`, `/health/ready`, `/api/v1/capabilities`.
11. Capture output into the Phase 1 evidence pack.
12. Any SDK shape/IDL mismatch => `PROTOCOL_COMPATIBILITY_HOLD`; do not patch by guessing field names. Reconcile against current official docs/SDK.
