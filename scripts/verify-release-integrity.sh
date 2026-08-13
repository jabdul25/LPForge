#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

fail(){ echo "RELEASE_INTEGRITY_FAIL: $*" >&2; exit 1; }

[[ -f SHA256SUMS.txt ]] || fail "SHA256SUMS.txt missing"
[[ -f RELEASE_MANIFEST.json ]] || fail "RELEASE_MANIFEST.json missing"
[[ -f SOURCE_REVISION.txt ]] || fail "SOURCE_REVISION.txt missing"
[[ -f SOURCE_GIT.bundle ]] || fail "SOURCE_GIT.bundle missing"
[[ -f pnpm-lock.yaml ]] || fail "pnpm-lock.yaml missing"
[[ ! -e .env ]] || fail ".env must not be shipped in release"

COUNT=$(grep -cE '^[0-9a-f]{64}  ' SHA256SUMS.txt || true)
[[ "$COUNT" -gt 0 ]] || fail "checksum manifest is empty"
sha256sum -c SHA256SUMS.txt >/tmp/lpforge-release-sha-check.$$ || {
  cat /tmp/lpforge-release-sha-check.$$ >&2 || true
  rm -f /tmp/lpforge-release-sha-check.$$
  fail "embedded file checksums mismatch"
}
rm -f /tmp/lpforge-release-sha-check.$$

REV=$(awk -F= '$1 == "source_git_commit" { if (++count == 1) print $2 } END { if (count != 1) exit 1 }' SOURCE_REVISION.txt | tr -d '\r')
[[ "$REV" =~ ^[0-9a-f]{40}$ ]] || fail "invalid source_git_commit"

if command -v git >/dev/null 2>&1; then
  TMP_REPO=$(mktemp -d)
  trap 'rm -rf "$TMP_REPO"' EXIT
  git clone -q SOURCE_GIT.bundle "$TMP_REPO/repo" || fail "SOURCE_GIT.bundle clone verification failed"
  GOT_REV=$(git -C "$TMP_REPO/repo" rev-parse HEAD 2>/dev/null || true)
  [[ "$GOT_REV" == "$REV" ]] || fail "source commit mismatch: bundle=${GOT_REV:-none} metadata=$REV"
  rm -rf "$TMP_REPO"
  trap - EXIT
fi

echo "RELEASE_INTEGRITY_PASS checksums=${COUNT} source_git_commit=${REV}"
