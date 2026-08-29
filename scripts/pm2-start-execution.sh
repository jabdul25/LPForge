#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
[[ -f .env.execution ]] || { echo 'ERROR: .env.execution missing. Copy .env.execution.example and configure the remote signer.' >&2; exit 1; }
# The deployed recovery worker is allowed to run with signing disabled.  Its
# launch assertion validates only read RPC, DB, and owner identity; it never
# constructs a signer or dispatches a plan until the explicit live runner is
# enabled in a later authorization.
node --env-file=.env --env-file=.env.execution --enable-source-maps .build/apps/execution/src/main.js assert-observe-launchable
command -v pm2 >/dev/null || { echo 'ERROR: pm2 is not installed.' >&2; exit 3; }
pm2 start ecosystem.config.cjs --only lpforge-execution
pm2 save
pm2 status lpforge-execution
