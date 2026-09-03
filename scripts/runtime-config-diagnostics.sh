#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
release_dir="$PWD"
# shellcheck source=runtime-config-paths.sh
source "$release_dir/scripts/runtime-config-paths.sh"
args=(--env-file="$LPFORGE_RUNTIME_ENV_SOURCE")
if [[ -f "$LPFORGE_RUNTIME_EXECUTION_ENV_SOURCE" ]]; then args+=(--env-file="$LPFORGE_RUNTIME_EXECUTION_ENV_SOURCE"); fi
exec node "${args[@]}" scripts/runtime-config-diagnostics.mjs
