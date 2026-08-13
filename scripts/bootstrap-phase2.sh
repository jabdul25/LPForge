#!/usr/bin/env bash
set -euo pipefail
if [[ $(node -p 'process.versions.node.split(".")[0]') != 24 ]]; then
  echo 'LPForge Phase 2 deployment baseline requires Node 24.x LTS' >&2
  exit 1
fi
corepack enable
pnpm install
pnpm typecheck
pnpm build
pnpm test:ci
pnpm phase2:fixture >/tmp/lpforge-phase2-fixture-report.json
node scripts/verify-phase2-boundary.mjs
cat <<'MSG'
LPForge Phase 2 local bootstrap gates passed.
Next: configure PostgreSQL 17, run pnpm db:migrate, switch to LIVE_READ_ONLY only after fixture verification, and run:
  pnpm lab -- live-pool <POOL_ADDRESS>
Never configure signer/private-key material in Phase 2.
MSG
