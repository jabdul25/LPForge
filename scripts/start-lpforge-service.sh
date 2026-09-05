#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."

service="${1:?LPFORGE_SERVICE_REQUIRED}"
# Runtime configuration is operational state, never release payload.  Keep
# the release cwd for immutable artifact verification while load paths remain
# stable across every nested immutable release.
LPFORGE_HOME="${LPFORGE_HOME:-/root/systems/LPForge}"
runtime_env="$LPFORGE_HOME/.env"
[[ -r "$runtime_env" ]] || { echo 'LPFORGE_RUNTIME_ENV_REQUIRED' >&2; exit 1; }
env_args=(--env-file="$runtime_env")
case "$service" in
  production) target='.build/apps/production/src/main.js' ;;
  discovery) target='.build/apps/discovery/src/main.js' ;;
  discovery-learning)
    target='.build/apps/discovery-learning/src/main.js'
    ;;
  execution)
    execution_env="$LPFORGE_HOME/.env.execution"
    [[ -r "$execution_env" ]] || { echo 'LPFORGE_EXECUTION_ENV_REQUIRED' >&2; exit 1; }
    env_args+=(--env-file="$execution_env")
    target='.build/apps/execution/src/main.js'
    ;;
  *) echo "LPFORGE_SERVICE_UNKNOWN:${service}" >&2; exit 1 ;;
esac

node "${env_args[@]}" scripts/verify-runtime-release-identity.mjs
exec node "${env_args[@]}" --enable-source-maps "$target" start
