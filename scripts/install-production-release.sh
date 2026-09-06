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
# A release template is promoted deliberately during deployment only.  It is
# never used as a runtime fallback and ordinary service restarts never invoke
# this installer.  Validate the release-bound template before atomically
# replacing the single central runtime authority.
template_policy="$stage/release-policy-templates/live-execution-policy.json"
runtime_policy="$lpforge_home/policy/live-execution-policy.json"
[[ -f "$template_policy" ]] || { echo 'LPFORGE_RUNTIME_POLICY_TEMPLATE_MISSING' >&2; exit 1; }
expected_policy_hash="$(node -e "const m=require(process.argv[1]);const h=m.runtimeExpectedPolicyHash??m.policyHash;if(!/^[0-9a-f]{64}$/i.test(String(h??'')))process.exit(2);process.stdout.write(h)" "$stage/RELEASE_MANIFEST.json")"
template_policy_hash="$(sha256sum "$template_policy" | awk '{print $1}')"
[[ "$template_policy_hash" == "$expected_policy_hash" ]] || { echo 'LPFORGE_RUNTIME_POLICY_TEMPLATE_HASH_MISMATCH' >&2; exit 1; }
node --input-type=module -e "const m=await import(process.argv[1]);m.loadDeploymentPolicyFile(process.argv[2]);" "$stage/.build/packages/deployment-policy/src/index.js" "$template_policy" || { echo 'LPFORGE_RUNTIME_POLICY_TEMPLATE_SCHEMA_INVALID' >&2; exit 1; }
mkdir -p "$lpforge_home/policy"
policy_stage="$(mktemp "$lpforge_home/policy/.live-execution-policy.json.XXXXXX")"
cleanup(){ rm -rf "$stage"; rm -f "${policy_stage:-}"; }
trap cleanup EXIT
install -m 0644 "$template_policy" "$policy_stage"
node --input-type=module -e "const m=await import(process.argv[1]);m.loadDeploymentPolicyFile(process.argv[2]);" "$stage/.build/packages/deployment-policy/src/index.js" "$policy_stage" || { echo 'LPFORGE_RUNTIME_POLICY_SCHEMA_INVALID' >&2; exit 1; }
[[ "$(sha256sum "$policy_stage" | awk '{print $1}')" == "$expected_policy_hash" ]] || { echo 'LPFORGE_RUNTIME_POLICY_HASH_MISMATCH' >&2; exit 1; }
mv -f "$policy_stage" "$runtime_policy"
unset policy_stage
[[ "$(sha256sum "$runtime_policy" | awk '{print $1}')" == "$expected_policy_hash" ]] || { echo 'LPFORGE_RUNTIME_POLICY_PROMOTION_HASH_MISMATCH' >&2; exit 1; }
LPFORGE_HOME="$lpforge_home" LPFORGE_RUNTIME_CONFIG_ENFORCED=true bash "$stage/scripts/verify-release-integrity.sh" "$stage"
mv "$stage" "$target"
trap - EXIT
printf '%s\n' "$target"
