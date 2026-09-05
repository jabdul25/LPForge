#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
release_dir="$PWD"
# shellcheck source=runtime-config-paths.sh
source "$release_dir/scripts/runtime-config-paths.sh"
mkdir -p logs
node --env-file="$LPFORGE_RUNTIME_ENV_SOURCE" -e 'for (const k of ["DATABASE_URL","SOLANA_RPC_HTTP_URL","LPFORGE_SMOKE_POOL_ADDRESS","LPFORGE_P7_INSTANCE_ID","LPFORGE_P7_DRIFT_BASELINE_JSON"]) { const v=process.env[k]||""; if(!v || v.includes("<REQUIRED_")) { console.error(`ERROR: ${k} is missing or still a placeholder`); process.exit(2); } } if ((process.env.LPFORGE_TELEGRAM_ALERTS_ENABLED||"false").toLowerCase()==="true") for (const k of ["LPFORGE_TELEGRAM_BOT_TOKEN","LPFORGE_TELEGRAM_CHAT_ID"]) { const v=process.env[k]||""; if(!v || v.includes("<REQUIRED_")) { console.error(`ERROR: ${k} is required when Telegram alerting is enabled`); process.exit(2); } }'
node --env-file="$LPFORGE_RUNTIME_ENV_SOURCE" scripts/verify-runtime-release-identity.mjs
node --env-file="$LPFORGE_RUNTIME_ENV_SOURCE" --enable-source-maps .build/apps/canary/src/main.js assert-read-only
command -v pm2 >/dev/null || { echo 'ERROR: pm2 is not installed.' >&2; exit 3; }
pm2 start ecosystem.config.cjs --only lpforge-production
pm2 save
pm2 status lpforge-production
