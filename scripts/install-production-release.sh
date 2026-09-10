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
# A release template is promoted deliberately during deployment only. It is
# never a release-local fallback. Every mounted policy required by the
# canonical runtime is staged and schema-validated before any PM2 restart.
runtime_policy_files=(
  live-execution-policy.json
  pool-discovery-policy.json
  autonomous-entry-policy.json
  live-position-management-policy.json
  oor-lifecycle-policy.json
  live-exit-governor-policy.json
)
validate_policy(){
  local name="$1" file="$2"
  case "$name" in
    live-execution-policy.json) node --input-type=module -e "const m=await import(process.argv[1]);m.loadDeploymentPolicyFile(process.argv[2]);" "$stage/.build/packages/deployment-policy/src/index.js" "$file" ;;
    pool-discovery-policy.json) node --input-type=module -e "const m=await import(process.argv[1]);m.parseDiscoveryPolicy(JSON.parse(await (await import('node:fs/promises')).readFile(process.argv[2],'utf8')));" "$stage/.build/packages/pool-discovery/src/index.js" "$file" ;;
    autonomous-entry-policy.json) node --input-type=module -e "const m=await import(process.argv[1]);m.loadAutonomousEntryPolicy(process.argv[2]);" "$stage/.build/packages/phase6-swap-quote/src/index.js" "$file" ;;
    live-position-management-policy.json) node --input-type=module -e "const m=await import(process.argv[1]);m.loadLivePositionManagementPolicy(process.argv[2]);" "$stage/.build/packages/live-position-management/src/index.js" "$file" ;;
    oor-lifecycle-policy.json) node --input-type=module -e "const m=await import(process.argv[1]);m.loadOorLifecyclePolicy(process.argv[2]);" "$stage/.build/packages/live-position-management/src/index.js" "$file" ;;
    live-exit-governor-policy.json) node --input-type=module -e "const m=await import(process.argv[1]);m.loadLiveExitGovernorPolicy(process.argv[2]);" "$stage/.build/packages/live-exit-governor/src/index.js" "$file" ;;
    *) echo "LPFORGE_RUNTIME_POLICY_UNKNOWN:${name}" >&2; return 1 ;;
  esac
}
mkdir -p "$lpforge_home/policy"
policy_stage_dir="$(mktemp -d "$lpforge_home/policy/.release-policy-stage.XXXXXX")"
cleanup(){ rm -rf "$stage" "${policy_stage_dir:-}"; }
trap cleanup EXIT
for policy_name in "${runtime_policy_files[@]}"; do
  template="$stage/release-policy-templates/$policy_name"
  [[ -f "$template" ]] || { echo "LPFORGE_RUNTIME_POLICY_TEMPLATE_MISSING:${policy_name}" >&2; exit 1; }
  expected_hash="$(node -e "const m=require(process.argv[1]),h=m.runtimePolicyTemplateHashes?.[process.argv[2]];if(!/^[0-9a-f]{64}$/i.test(String(h??'')))process.exit(2);process.stdout.write(h)" "$stage/RELEASE_MANIFEST.json" "$policy_name")"
  [[ "$(sha256sum "$template" | awk '{print $1}')" == "$expected_hash" ]] || { echo "LPFORGE_RUNTIME_POLICY_TEMPLATE_HASH_MISMATCH:${policy_name}" >&2; exit 1; }
  staged_policy="$policy_stage_dir/$policy_name"
  install -m 0644 "$template" "$staged_policy"
  validate_policy "$policy_name" "$staged_policy" || { echo "LPFORGE_RUNTIME_POLICY_SCHEMA_INVALID:${policy_name}" >&2; exit 1; }
done
for policy_name in "${runtime_policy_files[@]}"; do
  mv -f "$policy_stage_dir/$policy_name" "$lpforge_home/policy/$policy_name"
  expected_hash="$(node -e "const m=require(process.argv[1]),h=m.runtimePolicyTemplateHashes?.[process.argv[2]];process.stdout.write(String(h??''))" "$stage/RELEASE_MANIFEST.json" "$policy_name")"
  [[ "$(sha256sum "$lpforge_home/policy/$policy_name" | awk '{print $1}')" == "$expected_hash" ]] || { echo "LPFORGE_RUNTIME_POLICY_PROMOTION_HASH_MISMATCH:${policy_name}" >&2; exit 1; }
done
LPFORGE_HOME="$lpforge_home" LPFORGE_RUNTIME_CONFIG_ENFORCED=true bash "$stage/scripts/verify-release-integrity.sh" "$stage"
mv "$stage" "$target"
trap - EXIT
printf '%s\n' "$target"
