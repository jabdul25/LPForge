#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."

service="${1:?LPFORGE_SERVICE_REQUIRED}"
# This establishes the stable operational root and central configuration
# paths.  Immutable releases carry code only, never runtime configuration.
LPFORGE_HOME="${LPFORGE_HOME:-/root/systems/LPForge}"
# The shared path resolves the central .env.execution file for this service.
source scripts/runtime-config-paths.sh
env_args=(--env-file="$LPFORGE_RUNTIME_ENV_SOURCE")
case "$service" in
  production) target='.build/apps/production/src/main.js' ;;
  discovery) target='.build/apps/discovery/src/main.js' ;;
  discovery-learning)
    target='.build/apps/discovery-learning/src/main.js'
    ;;
  execution)
    execution_env="$LPFORGE_RUNTIME_EXECUTION_ENV_SOURCE"
    [[ -r "$execution_env" ]] || { echo 'LPFORGE_EXECUTION_ENV_REQUIRED' >&2; exit 1; }
    env_args+=(--env-file="$execution_env")
    target='.build/apps/execution/src/main.js'
    ;;
  *) echo "LPFORGE_SERVICE_UNKNOWN:${service}" >&2; exit 1 ;;
esac

node "${env_args[@]}" scripts/verify-runtime-release-identity.mjs
exec node "${env_args[@]}" --enable-source-maps "$target" start
