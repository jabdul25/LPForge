#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."

service="${1:?LPFORGE_SERVICE_REQUIRED}"
env_args=(--env-file=.env)
case "$service" in
  production) target='.build/apps/production/src/main.js' ;;
  discovery) target='.build/apps/discovery/src/main.js' ;;
  discovery-learning)
    target='.build/apps/discovery-learning/src/main.js'
    if [[ -z "${LPFORGE_FORWARD_VALIDATION_PRIORITY_SOURCE_SHA:-}" ]]; then
      export LPFORGE_FORWARD_VALIDATION_PRIORITY_SOURCE_SHA="$(node -e 'const manifest=require("./RELEASE_MANIFEST.json");if(typeof manifest.sourceCommit!=="string"||!/^[0-9a-f]{40}$/i.test(manifest.sourceCommit))process.exit(1);process.stdout.write(manifest.sourceCommit)')"
    fi
    ;;
  execution)
    [[ -f .env.execution ]] || { echo 'LPFORGE_EXECUTION_ENV_REQUIRED' >&2; exit 1; }
    env_args+=(--env-file=.env.execution)
    target='.build/apps/execution/src/main.js'
    ;;
  *) echo "LPFORGE_SERVICE_UNKNOWN:${service}" >&2; exit 1 ;;
esac

node "${env_args[@]}" scripts/verify-runtime-release-identity.mjs
exec node "${env_args[@]}" --enable-source-maps "$target" start
