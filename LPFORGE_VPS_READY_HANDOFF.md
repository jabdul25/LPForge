# LPForge P1-P7 v1.0.2 Operations-Ready VPS Handoff

This archive is prepared so the VPS work is deployment/validation, not development.

## Included before VPS
- Phase 7 production runtime integration and M0028.
- Telegram operational alerting with severity filtering and cooldown deduplication.
- PM2 single-instance production process with automatic restart.
- `.env.production.example` with placeholders and fail-closed defaults.
- PM2 start/restart/stop/status helper scripts.
- Source Git bundle and source revision for the operations-ready source.
- Historical v1.0.1 runtime-integration release evidence preserved separately.

## First VPS sequence
1. Verify the outer SHA-256 and run `bash scripts/verify-release-integrity.sh`.
2. Install the pinned Node/pnpm dependencies from `pnpm-lock.yaml` and run `pnpm install --frozen-lockfile`.
3. Run `pnpm test:ci` before production startup.
4. Apply migrations through M0028 without deleting prior LPForge data.
5. Copy `.env.production.example` to `.env`, fill the required placeholders, and keep execution/canary/signing flags false.
6. Build with `pnpm build`.
7. Start with `pnpm pm2:start`; use `pnpm pm2:restart` after approved environment changes.
8. Run read-only production evidence cycles before any canary approval.

The archived v1.0.1 runtime evidence proves the underlying runtime integration baseline. Because this operations-ready release has a new source commit, do not relabel the old 336-test evidence as evidence for the new commit. The VPS full regression produces the final deployment evidence for this source revision.
