#!/usr/bin/env bash
set -euo pipefail
if [[ $(node -p 'process.versions.node.split(".")[0]') != 24 ]]; then echo 'LPForge Phase1 requires Node 24.x LTS' >&2; exit 1; fi
corepack enable
pnpm install
pnpm typecheck
pnpm build
pnpm test:ci
echo 'Bootstrap verification complete. Configure PostgreSQL/RPC and run pnpm db:migrate next.'
