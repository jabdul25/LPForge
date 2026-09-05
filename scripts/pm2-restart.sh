#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
release_dir="$PWD"
# shellcheck source=runtime-config-paths.sh
source "$release_dir/scripts/runtime-config-paths.sh"
# PM2 `restart` retains the registered cwd of an existing named process.  A
# release therefore has to replace the registrations, not merely signal the
# old launchers, or the prior immutable release continues running unnoticed.
pm2 delete lpforge-execution || true
pm2 delete lpforge-production || true
pm2 start ecosystem.config.cjs --only lpforge-production
pm2 start ecosystem.config.cjs --only lpforge-execution
pm2 save
pm2 status lpforge-production lpforge-execution
