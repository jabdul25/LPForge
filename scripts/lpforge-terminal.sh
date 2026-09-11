#!/usr/bin/env bash
# Stable, operator-facing entrypoint for the read-only shell Decision Terminal.
# It intentionally selects a separately promoted immutable terminal release;
# it does not infer authority from a mutable checkout or from PM2 state.
set -euo pipefail

lpforge_home="${LPFORGE_HOME:-/root/systems/LPForge}"
case "$lpforge_home" in /*) ;; *) echo 'LPFORGE_RUNTIME_CONFIG_ABSOLUTE_HOME_REQUIRED' >&2; exit 1;; esac
lpforge_home="${lpforge_home%/}"
release_dir="${LPFORGE_TERMINAL_RELEASE_DIR:-$lpforge_home/releases/terminal-current}"
case "$release_dir" in "$lpforge_home"/releases/*) ;; *) echo 'LPFORGE_TERMINAL_RELEASE_LAYOUT_INVALID' >&2; exit 1;; esac
[[ -d "$release_dir" ]] || { echo "LPFORGE_TERMINAL_RELEASE_MISSING:${release_dir}" >&2; exit 1; }
exec "$release_dir/scripts/start-lpforge-service.sh" terminal "$@"
