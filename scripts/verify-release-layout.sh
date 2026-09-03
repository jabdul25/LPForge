#!/usr/bin/env bash
set -euo pipefail
lpforge_home="${LPFORGE_HOME:-/root/systems/LPForge}"
release_dir="${1:-$(pwd)}"
case "$lpforge_home" in /*) ;; *) echo 'LPFORGE_RELEASE_LAYOUT_HOME_ABSOLUTE_REQUIRED' >&2; exit 1;; esac
case "$release_dir" in "$lpforge_home"/releases/*) ;; *) echo "LPFORGE_RELEASE_LAYOUT_FORBIDDEN:${release_dir}" >&2; exit 1;; esac
[[ ! -e "$release_dir/.env" && ! -e "$release_dir/.env.execution" ]] || { echo 'LPFORGE_RELEASE_LAYOUT_LOCAL_ENV_FORBIDDEN' >&2; exit 1; }
[[ -L "$release_dir/node_modules" && "$(readlink -f "$release_dir/node_modules")" == "$lpforge_home/node_modules" ]] || { echo 'LPFORGE_RELEASE_LAYOUT_NODE_MODULES_INVALID' >&2; exit 1; }
echo "LPFORGE_RELEASE_LAYOUT_PASS:$release_dir"
