#!/usr/bin/env bash
set -euo pipefail
ROOT="${1:-$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)}"
[[ -d "$ROOT" ]] || { echo "RELEASE_INTEGRITY_FAIL: release root does not exist: $ROOT" >&2; exit 1; }
cd "$ROOT"

fail(){ echo "RELEASE_INTEGRITY_FAIL: $*" >&2; exit 1; }

[[ -f SHA256SUMS.txt ]] || fail "SHA256SUMS.txt missing"
[[ -f RELEASE_MANIFEST.json ]] || fail "RELEASE_MANIFEST.json missing"
[[ -f SOURCE_REVISION.txt ]] || fail "SOURCE_REVISION.txt missing"
[[ -f pnpm-lock.yaml ]] || fail "pnpm-lock.yaml missing"

# A release is an immutable executable artifact, never a configuration mount.
# Runtime verification is deliberately just as strict as build verification.
[[ ! -e .env ]] || fail ".env must not be present in release"
[[ ! -e .env.execution ]] || fail ".env.execution must not be present in release"
if find . -type f \( -name '.env' -o -name '.env.*' \) ! -name '*.example' -print -quit | grep -q .; then
  fail "non-example environment file must not be present in release"
fi

COUNT=$(grep -cE '^[0-9a-f]{64}  ' SHA256SUMS.txt || true)
[[ "$COUNT" -gt 0 ]] || fail "checksum manifest is empty"
workdir=$(mktemp -d)
trap 'rm -rf "$workdir"' EXIT
awk '/^[0-9a-f]{64}  / { print substr($0, 67) }' SHA256SUMS.txt | sort >"$workdir/checksummed-files"
[[ "$(uniq "$workdir/checksummed-files" | wc -l)" -eq "$COUNT" ]] || fail "checksum manifest has duplicate members"
# The hash manifest covers the immutable payload, including .build. Runtime
# state is mounted outside that payload and deliberately excluded.
find . -type f \
  ! -name 'SHA256SUMS.txt' \
  ! -path './.git/*' \
  ! -path './node_modules/*' \
  ! -path './.pnpm-store/*' \
  \( ! -path './logs/*' -o -path './logs/.gitkeep' \) \
  ! -name '.env' \
  ! \( -name '.env.*' ! -name '*.example' \) \
  ! -name 'SOURCE_GIT.bundle' \
  ! -name 'PHASE7_RUNTIME_RELEASE_EVIDENCE.json' \
  ! -name 'SECURITY_SANITIZATION.txt' \
  -print | sort >"$workdir/runtime-files"
if ! diff -u "$workdir/checksummed-files" "$workdir/runtime-files" >&2; then
  fail "checksum manifest members do not exactly cover immutable release payload"
fi
sha256sum -c SHA256SUMS.txt >"$workdir/sha-check" || {
  cat "$workdir/sha-check" >&2 || true
  fail "embedded file checksums mismatch"
}

REV=$(awk -F= '$1 == "source_git_commit" { if (++count == 1) print $2 } END { if (count != 1) exit 1 }' SOURCE_REVISION.txt | tr -d '\r')
[[ "$REV" =~ ^[0-9a-f]{40}$ ]] || fail "invalid source_git_commit"
MANIFEST_REV=$(node -e 'const fs=require("fs"); const m=JSON.parse(fs.readFileSync("RELEASE_MANIFEST.json","utf8")); process.stdout.write(String(m.sourceCommit ?? ""));')
[[ "$MANIFEST_REV" == "$REV" ]] || fail "source commit mismatch: manifest=${MANIFEST_REV:-none} metadata=$REV"

mapfile -t manifest < <(node - <<'NODE'
const fs=require('fs');
const m=JSON.parse(fs.readFileSync('RELEASE_MANIFEST.json','utf8'));
for(const key of ['sourceCommit','policyHash','migrationCount','migrationHead','buildIdentity','nodeVersion','pnpmVersion','lockfileHash']){
  const value=m[key];
  if(value===undefined||value===null||value==='')process.exit(2);
  process.stdout.write(String(value)+'\n');
}
NODE
) || fail "manifest required identity fields are missing"
[[ "${#manifest[@]}" -eq 8 ]] || fail "manifest identity projection malformed"
manifest_source="${manifest[0]}"
manifest_policy="${manifest[1]}"
manifest_migration_count="${manifest[2]}"
manifest_migration_head="${manifest[3]}"
manifest_build="${manifest[4]}"
manifest_node="${manifest[5]}"
manifest_pnpm="${manifest[6]}"
manifest_lock="${manifest[7]}"
[[ "$manifest_source" == "$REV" ]] || fail "manifest source identity mismatch"
[[ "$manifest_policy" =~ ^[0-9a-f]{64}$ ]] || fail "manifest policy hash invalid"
[[ "$manifest_build" =~ ^[0-9a-f]{64}$ ]] || fail "manifest build identity invalid"
[[ "$manifest_lock" =~ ^[0-9a-f]{64}$ ]] || fail "manifest lockfile hash invalid"

if [[ "${LPFORGE_RUNTIME_CONFIG_ENFORCED:-false}" == "true" ]]; then
  config_root="${LPFORGE_HOME:-/root/systems/LPForge}"
  [[ "$config_root" == /* ]] || fail "LPFORGE_HOME must be absolute"
  policy="$config_root/policy/live-execution-policy.json"
else
  policy="${LPFORGE_EXECUTION_POLICY_PATH:-policies/live-execution-policy.json}"
fi
[[ -f "$policy" ]] || fail "canonical execution policy missing"
actual_policy=$(sha256sum "$policy" | awk '{print $1}')
[[ "$actual_policy" == "$manifest_policy" ]] || fail "policy hash mismatch"
actual_lock=$(sha256sum pnpm-lock.yaml | awk '{print $1}')
[[ "$actual_lock" == "$manifest_lock" ]] || fail "lockfile hash mismatch"
mapfile -t migrations < <(find packages/db/migrations -maxdepth 1 -type f -printf '%f\n' | grep -E '^M[0-9]{4}_.+\.sql$' | sort)
[[ "${#migrations[@]}" -gt 0 ]] || fail "migration set missing"
[[ "$manifest_migration_count" == "${#migrations[@]}" && "$manifest_migration_head" == "${migrations[-1]}" ]] || fail "migration identity mismatch"
actual_build=$(printf '%s\n%s\n%s\n%s\n' "$REV" "$actual_policy" "${migrations[-1]}" "$actual_lock" | sha256sum | awk '{print $1}')
[[ "$actual_build" == "$manifest_build" ]] || fail "build identity mismatch"

node -e 'const expected=process.argv[1],actual=process.version;const norm=v=>{const m=/^v?(\d+)\.(\d+)\.(\d+)$/.exec(v);return m?m.slice(1).join("."):""};if(!norm(expected)||norm(expected)!==norm(actual))process.exit(1);' "$manifest_node" || fail "runtime Node version mismatch"
command -v pnpm >/dev/null 2>&1 || fail "pnpm is required by this runtime release model"
actual_pnpm=$(pnpm --version)
node -e 'const expected=process.argv[1],actual=process.argv[2];const norm=v=>{const m=/^v?(\d+)\.(\d+)\.(\d+)$/.exec(v);return m?m.slice(1).join("."):""};if(!norm(expected)||norm(expected)!==norm(actual))process.exit(1);' "$manifest_pnpm" "$actual_pnpm" || fail "runtime pnpm version mismatch expected=${manifest_pnpm} actual=${actual_pnpm}"

# Legacy values are compatibility assertions only. They never supply identity.
[[ -z "${LPFORGE_SOURCE_COMMIT:-}" || "$LPFORGE_SOURCE_COMMIT" == "$REV" ]] || fail "LPFORGE_SOURCE_COMMIT assertion mismatch"
[[ -z "${LPFORGE_BUILD_ID:-}" || "$LPFORGE_BUILD_ID" == "$manifest_build" ]] || fail "LPFORGE_BUILD_ID assertion mismatch"
[[ -z "${LPFORGE_P7_POLICY_HASH:-}" || "$LPFORGE_P7_POLICY_HASH" == "$actual_policy" ]] || fail "LPFORGE_P7_POLICY_HASH assertion mismatch"
if [[ -n "${LPFORGE_APPROVED_RELEASE_IDENTITY_PATH:-}" ]]; then
  node - "$LPFORGE_APPROVED_RELEASE_IDENTITY_PATH" <<'NODE' || fail "approved release identity assertion mismatch"
const fs=require('fs');
const [approvedPath]=process.argv.slice(2);
const current=JSON.parse(fs.readFileSync('RELEASE_MANIFEST.json','utf8'));
const approved=JSON.parse(fs.readFileSync(approvedPath,'utf8'));
for(const key of ['sourceCommit','policyHash','migrationCount','migrationHead','buildIdentity','nodeVersion','pnpmVersion','lockfileHash'])if(approved[key]!==current[key])process.exit(1);
NODE
fi

echo "RELEASE_INTEGRITY_PASS checksums=${COUNT} source_git_commit=${REV} build_identity=${manifest_build} policy_hash=${actual_policy} migration_head=${migrations[-1]} node_version=$(node --version) pnpm_version=${actual_pnpm}"
