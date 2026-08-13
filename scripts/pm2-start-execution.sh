#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
[[ -f .env.execution ]] || { echo 'ERROR: .env.execution missing. Copy .env.execution.example and configure the remote signer.' >&2; exit 1; }
node --env-file=.env --env-file=.env.execution --enable-source-maps .build/apps/execution/src/main.js assert-launchable
command -v pm2 >/dev/null || { echo 'ERROR: pm2 is not installed.' >&2; exit 3; }
pm2 start ecosystem.config.cjs --only lpforge-execution
pm2 save
pm2 status lpforge-execution
