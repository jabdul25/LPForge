#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"
fail(){ echo "LPFORGE_VPS_PREFLIGHT_HOLD: $*" >&2; exit 1; }

./scripts/verify-release-integrity.sh

command -v node >/dev/null 2>&1 || fail "node is unavailable; require >=24.19 <25"
NODE_VER=$(node -p 'process.versions.node')
node -e 'const [a,b]=process.versions.node.split(".").map(Number); if(a!==24 || b<19) process.exit(1)' \
  || fail "Node ${NODE_VER} does not satisfy >=24.19 <25"

command -v pnpm >/dev/null 2>&1 || fail "pnpm is unavailable; require 11.21.0"
PNPM_VER=$(pnpm --version)
[[ "$PNPM_VER" == "11.21.0" ]] || fail "pnpm ${PNPM_VER} != 11.21.0"

command -v psql >/dev/null 2>&1 || fail "psql is unavailable; require PostgreSQL 17 client/server"
PSQL_MAJOR=$(psql --version | sed -E 's/.* ([0-9]+)(\..*)?$/\1/')
[[ "$PSQL_MAJOR" == "17" ]] || fail "psql major ${PSQL_MAJOR} != 17"

DB_URL="${DATABASE_URL:-postgresql:///postgres}"
SERVER_NUM=$(psql "$DB_URL" -Atqc 'SHOW server_version_num' 2>/dev/null || true)
[[ "$SERVER_NUM" =~ ^17[0-9]{4}$ ]] || fail "PostgreSQL 17 server not reachable via DATABASE_URL/default local connection (server_version_num=${SERVER_NUM:-none})"

for key in LIVE_SIGNING LPFORGE_LIVE_EXECUTION LPFORGE_MAINNET_CANARY; do
  val="${!key:-false}"
  case "${val,,}" in
    false|0|no|off|'') ;;
    *) fail "$key must remain false during mandatory Phase 5 preflight" ;;
  esac
done

[[ ! -f .env ]] || fail ".env must be created only from operator-controlled deployment secrets; release must not supply one"

echo "LPFORGE_VPS_PREFLIGHT_PASS node=${NODE_VER} pnpm=${PNPM_VER} psql_major=${PSQL_MAJOR} postgres_server_num=${SERVER_NUM}"
