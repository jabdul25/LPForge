#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
mkdir -p logs
[[ -f .env ]] || { echo 'ERROR: .env missing.' >&2; exit 1; }
node --env-file=.env -e 'for (const k of ["DATABASE_URL"]) { const v=process.env[k]||""; if(!v || v.includes("<REQUIRED_")) { console.error("ERROR: "+k+" is missing or still a placeholder"); process.exit(2); } }'
node -e 'const fs=require("node:fs");const p="policies/pool-discovery-policy.json";if(!fs.existsSync(p))process.exit(2);const x=JSON.parse(fs.readFileSync(p,"utf8"));if(x.schemaVersion!==1)process.exit(2);'
command -v pm2 >/dev/null || { echo 'ERROR: pm2 is not installed.' >&2; exit 3; }
pm2 start ecosystem.config.cjs --only lpforge-discovery,lpforge-discovery-learning
pm2 save
pm2 status lpforge-discovery lpforge-discovery-learning
