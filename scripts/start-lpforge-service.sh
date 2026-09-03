#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
release_dir="$PWD"
# shellcheck source=runtime-config-paths.sh
source "$release_dir/scripts/runtime-config-paths.sh"

service="${1:?LPFORGE_SERVICE_REQUIRED}"
env_args=(--env-file="$LPFORGE_RUNTIME_ENV_SOURCE")
case "$service" in
  production) target='.build/apps/production/src/main.js' ;;
  discovery) target='.build/apps/discovery/src/main.js' ;;
  discovery-learning)
    target='.build/apps/discovery-learning/src/main.js'
    ;;
  execution)
    [[ -f "$LPFORGE_RUNTIME_EXECUTION_ENV_SOURCE" ]] || { echo "LPFORGE_EXECUTION_ENV_REQUIRED:${LPFORGE_RUNTIME_EXECUTION_ENV_SOURCE}" >&2; exit 1; }
    env_args+=(--env-file="$LPFORGE_RUNTIME_EXECUTION_ENV_SOURCE")
    target='.build/apps/execution/src/main.js'
    ;;
  *) echo "LPFORGE_SERVICE_UNKNOWN:${service}" >&2; exit 1 ;;
esac

node "${env_args[@]}" scripts/verify-runtime-release-identity.mjs
exec node "${env_args[@]}" --enable-source-maps "$target" start
