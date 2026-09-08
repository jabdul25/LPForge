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
  production)
    # Node's --env-file intentionally does not overwrite inherited values.
    # PM2 can retain an old environment across release replacement, so an
    # inherited malformed P7 baseline must not mask the canonical central
    # runtime value. These three variables are defined solely by .env for the
    # Production control runtime.
    unset LPFORGE_P7_DRIFT_BASELINE_JSON LPFORGE_P7_INSTANCE_ID LPFORGE_P7_RUNTIME_ID
    export LPFORGE_RPC_ROLE=PRODUCTION
    target='.build/apps/production/src/main.js'
    ;;
  discovery)
    # PM2 may retain environment values from a prior execution process.  The
    # discovery collector is read-only and must never inherit a signing mode
    # or signer material merely because it shares the PM2 daemon.
    unset LIVE_SIGNING LPFORGE_LIVE_SIGNING PRIVATE_KEY SEED_PHRASE WALLET_SECRET WALLET_PRIVATE_KEY SIGNER_KEYPAIR
    export LPFORGE_RPC_ROLE=DISCOVERY
    target='.build/apps/discovery/src/main.js'
    ;;
  discovery-learning)
    # Learning has the same observation-only contract as discovery.
    unset LIVE_SIGNING LPFORGE_LIVE_SIGNING PRIVATE_KEY SEED_PHRASE WALLET_SECRET WALLET_PRIVATE_KEY SIGNER_KEYPAIR
    export LPFORGE_RPC_ROLE=DISCOVERY
    target='.build/apps/discovery-learning/src/main.js'
    ;;
  execution)
    execution_env="$LPFORGE_RUNTIME_EXECUTION_ENV_SOURCE"
    [[ -r "$execution_env" ]] || { echo 'LPFORGE_EXECUTION_ENV_REQUIRED' >&2; exit 1; }
    # Execution authority is deliberately defined by the central
    # .env.execution file. Node does not overwrite inherited environment
    # values when loading --env-file, and PM2 retains its daemon environment
    # across release replacement. Clear only execution-owned values before
    # loading the execution file first, so a stale base/PM2 false value cannot
    # silently disable a configured live executor (or mask signer rotation).
    # The canonical policy path is intentionally not cleared: runtime-config-
    # paths.sh has already bound it to the central policy authority.
    unset LIVE_SIGNING LPFORGE_LIVE_SIGNING LPFORGE_LIVE_EXECUTION \
      LPFORGE_MAINNET_CANARY LPFORGE_MAINNET_CANARY_CAMPAIGN_ID \
      LPFORGE_P6_PRIVATE_KEY LPFORGE_P6_PRIVATE_WRITE_RPC_URL \
      LPFORGE_P6_SIGNER_BACKEND_ID LPFORGE_P6_SIGNER_MODE \
      LPFORGE_P6_SIGNER_PUBLIC_KEY
    export LPFORGE_RPC_ROLE=EXECUTION
    # First file wins for Node --env-file variables. The base runtime file
    # remains available for shared non-execution configuration only.
    env_args=(--env-file="$execution_env" --env-file="$LPFORGE_RUNTIME_ENV_SOURCE")
    target='.build/apps/execution/src/main.js'
    ;;
  telegram-operator)
    # This process receives operator intent only.  It never imports signer
    # material or execution transport, and it is safe to run disabled until
    # the explicit allowlist is configured in the external runtime env.
    unset LIVE_SIGNING LPFORGE_LIVE_SIGNING PRIVATE_KEY SEED_PHRASE WALLET_SECRET WALLET_PRIVATE_KEY SIGNER_KEYPAIR
    export LPFORGE_RPC_ROLE=PRODUCTION
    target='.build/apps/telegram-operator/src/main.js'
    ;;
  *) echo "LPFORGE_SERVICE_UNKNOWN:${service}" >&2; exit 1 ;;
esac

node "${env_args[@]}" scripts/verify-runtime-release-identity.mjs
exec node "${env_args[@]}" --enable-source-maps "$target" start
