#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
release_dir="$PWD"
# shellcheck source=runtime-config-paths.sh
source "$release_dir/scripts/runtime-config-paths.sh"
pm2 status lpforge-production lpforge-execution lpforge-discovery lpforge-discovery-learning
node --env-file="$LPFORGE_RUNTIME_ENV_SOURCE" --enable-source-maps .build/apps/production/src/main.js status
