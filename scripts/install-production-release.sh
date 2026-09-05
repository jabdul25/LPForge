#!/usr/bin/env bash
# Install a verified immutable artifact below the stable LPForge home. The
# installer never creates a sibling /root/systems/LPForge-release-* directory.
set -euo pipefail

archive="${1:?LPFORGE_RELEASE_ARCHIVE_REQUIRED}"
lpforge_home="${LPFORGE_HOME:-/root/systems/LPForge}"
case "$lpforge_home" in /*) ;; *) echo 'LPFORGE_RUNTIME_CONFIG_ABSOLUTE_HOME_REQUIRED' >&2; exit 1;; esac
[[ -f "$archive" ]] || { echo "LPFORGE_RELEASE_ARCHIVE_MISSING:${archive}" >&2; exit 1; }
mkdir -p "$lpforge_home/releases"
chmod 0755 "$lpforge_home/releases"

stage="$(mktemp -d "$lpforge_home/releases/.install.XXXXXX")"
cleanup(){ rm -rf "$stage"; }
trap cleanup EXIT
tar -xzf "$archive" -C "$stage"
source_sha="$(node -e "const m=require(process.argv[1]);if(!/^[0-9a-f]{40}$/i.test(String(m.sourceCommit??'')))process.exit(2);process.stdout.write(m.sourceCommit)" "$stage/RELEASE_MANIFEST.json")"
target="$lpforge_home/releases/$source_sha"
[[ ! -e "$target" ]] || { echo "LPFORGE_RELEASE_ALREADY_EXISTS:${target}" >&2; exit 1; }
[[ ! -e "$stage/.env" && ! -e "$stage/.env.execution" ]] || { echo 'LPFORGE_RELEASE_LOCAL_ENV_FORBIDDEN' >&2; exit 1; }
ln -s "$lpforge_home/node_modules" "$stage/node_modules"
LPFORGE_HOME="$lpforge_home" LPFORGE_RUNTIME_CONFIG_ENFORCED=true bash "$stage/scripts/verify-release-integrity.sh" "$stage"
mv "$stage" "$target"
trap - EXIT
printf '%s\n' "$target"
