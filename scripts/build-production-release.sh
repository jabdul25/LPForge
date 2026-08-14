#!/usr/bin/env bash
set -euo pipefail

# Builds from Git's tracked tree, never from a recursive working-directory zip.
root="$(git rev-parse --show-toplevel)"
cd "$root"
test -z "$(git status --porcelain)" || { echo 'release requires a clean Git worktree' >&2; exit 1; }
sha="$(git rev-parse HEAD)"
policy="${LPFORGE_EXECUTION_POLICY_PATH:-policies/live-execution-policy.json}"
test -f "$policy" || { echo "missing policy: $policy" >&2; exit 1; }
pnpm test:ci
stage="$(mktemp -d)"
trap 'rm -rf "$stage"' EXIT
git archive --format=tar "$sha" | tar -xf - -C "$stage"
mapfile -t migrations < <(find "$stage/packages/db/migrations" -maxdepth 1 -type f -printf '%f\n' | grep -E '^M[0-9]{4}_.+\.sql$' | sort)
test "${#migrations[@]}" -gt 0
policy_hash="$(sha256sum "$policy" | awk '{print $1}')"
lock_hash="$(sha256sum pnpm-lock.yaml | awk '{print $1}')"
build_id="$(printf '%s\n%s\n%s\n%s\n' "$sha" "$policy_hash" "${migrations[-1]}" "$lock_hash" | sha256sum | awk '{print $1}')"
node -e 'const fs=require("fs");fs.writeFileSync(process.argv[1],JSON.stringify({sourceCommit:process.argv[2],policyHash:process.argv[3],migrationCount:Number(process.argv[4]),migrationHead:process.argv[5],buildIdentity:process.argv[6],nodeVersion:process.version,pnpmVersion:process.argv[7],lockfileHash:process.argv[8]},null,2)+"\n")' "$stage/RELEASE_MANIFEST.json" "$sha" "$policy_hash" "${#migrations[@]}" "${migrations[-1]}" "$build_id" "$(pnpm --version)" "$lock_hash"
out="${1:-$root/LPForge_Production_${sha:0:12}.tar.gz}"
tar -C "$stage" --exclude-vcs --exclude='node_modules' --exclude='.pnpm-store' --exclude='*.swp' -czf "$out" .
sha256sum "$out"
