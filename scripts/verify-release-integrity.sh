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
[[ ! -e .env ]] || fail ".env must not be shipped in release"
if find . -type f \( -name '.env' -o -name '.env.*' \) ! -name '.env.example' -print -quit | grep -q .; then
  fail "non-example environment file must not be shipped in release"
fi

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
MANIFEST_REV=$(node -e 'const fs=require("fs"); const m=JSON.parse(fs.readFileSync("RELEASE_MANIFEST.json","utf8")); process.stdout.write(String(m.sourceCommit ?? ""));')
[[ "$MANIFEST_REV" == "$REV" ]] || fail "source commit mismatch: manifest=${MANIFEST_REV:-none} metadata=$REV"

echo "RELEASE_INTEGRITY_PASS checksums=${COUNT} source_git_commit=${REV}"
