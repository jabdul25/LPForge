#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
release_dir="$PWD"
# shellcheck source=runtime-config-paths.sh
source "$release_dir/scripts/runtime-config-paths.sh"
pm2 stop lpforge-execution
pm2 restart ecosystem.config.cjs --only lpforge-production --update-env
pm2 restart ecosystem.config.cjs --only lpforge-execution --update-env
pm2 save
pm2 status lpforge-production lpforge-execution
