#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
release_dir="$PWD"
# shellcheck source=runtime-config-paths.sh
source "$release_dir/scripts/runtime-config-paths.sh"
mkdir -p logs
node --env-file="$LPFORGE_RUNTIME_ENV_SOURCE" -e 'for (const k of ["DATABASE_URL"]) { const v=process.env[k]||""; if(!v || v.includes("<REQUIRED_")) { console.error("ERROR: "+k+" is missing or still a placeholder"); process.exit(2); } }'
node --env-file="$LPFORGE_RUNTIME_ENV_SOURCE" scripts/verify-runtime-release-identity.mjs
node -e 'const fs=require("node:fs");const p=process.env.LPFORGE_DISCOVERY_POLICY_PATH||"policies/pool-discovery-policy.json";if(!fs.existsSync(p))process.exit(2);const x=JSON.parse(fs.readFileSync(p,"utf8"));if(x.schemaVersion!==1)process.exit(2);'
command -v pm2 >/dev/null || { echo 'ERROR: pm2 is not installed.' >&2; exit 3; }
pm2 start ecosystem.config.cjs --only lpforge-discovery,lpforge-discovery-learning
pm2 save
pm2 status lpforge-discovery lpforge-discovery-learning
