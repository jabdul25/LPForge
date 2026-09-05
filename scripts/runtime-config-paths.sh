#!/usr/bin/env bash
# Shared production runtime configuration contract. Source and immutable
# release trees both execute this file; only the stable operational root owns
# live configuration and policy.
set -euo pipefail

lpforge_config_root="${LPFORGE_HOME:-/root/systems/LPForge}"
case "$lpforge_config_root" in
  /*) ;;
  *) echo 'LPFORGE_RUNTIME_CONFIG_ABSOLUTE_HOME_REQUIRED' >&2; exit 1 ;;
esac
lpforge_config_root="${lpforge_config_root%/}"
[[ -d "$lpforge_config_root" ]] || { echo "LPFORGE_RUNTIME_CONFIG_ROOT_MISSING:${lpforge_config_root}" >&2; exit 1; }

export LPFORGE_HOME="$lpforge_config_root"
export LPFORGE_RUNTIME_CONFIG_ENFORCED=true
export LPFORGE_RUNTIME_ENV_SOURCE="$LPFORGE_HOME/.env"
export LPFORGE_RUNTIME_EXECUTION_ENV_SOURCE="$LPFORGE_HOME/.env.execution"
export LPFORGE_EXECUTION_POLICY_PATH="$LPFORGE_HOME/policy/live-execution-policy.json"
export LPFORGE_DISCOVERY_POLICY_PATH="$LPFORGE_HOME/policy/pool-discovery-policy.json"
export LPFORGE_AUTONOMOUS_ENTRY_POLICY_PATH="$LPFORGE_HOME/policy/autonomous-entry-policy.json"
export LPFORGE_LIVE_MANAGEMENT_POLICY_PATH="$LPFORGE_HOME/policy/live-position-management-policy.json"
export LPFORGE_OOR_LIFECYCLE_POLICY_PATH="$LPFORGE_HOME/policy/oor-lifecycle-policy.json"
export LPFORGE_LIVE_EXIT_POLICY_PATH="$LPFORGE_HOME/policy/live-exit-governor-policy.json"

# Immutable runtime artifacts must live below the stable home. This prevents a
# future activation from silently restoring the deprecated sibling layout.
lpforge_release_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
case "$lpforge_release_dir" in
  "$LPFORGE_HOME"/releases/*) ;;
  *) echo "LPFORGE_RELEASE_LAYOUT_REQUIRED:${LPFORGE_HOME}/releases/<sha>" >&2; exit 1 ;;
esac

[[ -f "$LPFORGE_RUNTIME_ENV_SOURCE" ]] || { echo "LPFORGE_RUNTIME_ENV_REQUIRED:${LPFORGE_RUNTIME_ENV_SOURCE}" >&2; exit 1; }
[[ -f "$LPFORGE_EXECUTION_POLICY_PATH" ]] || { echo "LPFORGE_RUNTIME_POLICY_REQUIRED:${LPFORGE_EXECUTION_POLICY_PATH}" >&2; exit 1; }
for lpforge_policy in "$LPFORGE_DISCOVERY_POLICY_PATH" "$LPFORGE_AUTONOMOUS_ENTRY_POLICY_PATH" "$LPFORGE_LIVE_MANAGEMENT_POLICY_PATH" "$LPFORGE_OOR_LIFECYCLE_POLICY_PATH" "$LPFORGE_LIVE_EXIT_POLICY_PATH"; do
  [[ -f "$lpforge_policy" ]] || { echo "LPFORGE_RUNTIME_POLICY_REQUIRED:${lpforge_policy}" >&2; exit 1; }
done
