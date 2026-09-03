#!/usr/bin/env bash
set -euo pipefail

# Builds from Git's tracked tree, never from a recursive working-directory zip.
# Every provenance file below is generated inside the staging tree for this exact
# commit.  Legacy root-level release metadata must never be carried forward.
root="$(git rev-parse --show-toplevel)"
cd "$root"
# The artifact is produced exclusively from HEAD.  Generated release metadata
# belongs to the deployed release, not the next source commit, so it may be
# refreshed by an already-running release without changing the source payload.
# All other tracked source changes must be committed before packaging.
git diff --quiet -- . \
  ':(exclude)RELEASE_MANIFEST.json' \
  ':(exclude)SOURCE_REVISION.txt' \
  ':(exclude)SHA256SUMS.txt' || { echo 'release requires committed tracked source changes' >&2; exit 1; }
git diff --cached --quiet -- . \
  ':(exclude)RELEASE_MANIFEST.json' \
  ':(exclude)SOURCE_REVISION.txt' \
  ':(exclude)SHA256SUMS.txt' || { echo 'release requires committed staged source changes' >&2; exit 1; }
sha="$(git rev-parse HEAD)"
policy='policies/live-execution-policy.json'
test -f "$policy" || { echo "missing policy: $policy" >&2; exit 1; }
pnpm test:ci
stage="$(mktemp -d)"
trap 'rm -rf "$stage"' EXIT
git archive --format=tar "$sha" | tar \
  --exclude='RELEASE_MANIFEST.json' \
  --exclude='SOURCE_REVISION.txt' \
  --exclude='SHA256SUMS.txt' \
  --exclude='SOURCE_GIT.bundle' \
  --exclude='PHASE7_RUNTIME_RELEASE_EVIDENCE.json' \
  --exclude='SECURITY_SANITIZATION.txt' \
  --exclude='SECURITY_SANITIZATION.json' \
  -xf - -C "$stage"
# The production process executes this compiled tree. Ship it inside the
# immutable artifact and hash it with the rest of the release payload.
[[ -d .build ]] || { echo 'missing compiled .build output after canonical CI' >&2; exit 1; }
cp -a .build "$stage/.build"
mapfile -t migrations < <(find "$stage/packages/db/migrations" -maxdepth 1 -type f -printf '%f\n' | grep -E '^M[0-9]{4}_.+\.sql$' | sort)
test "${#migrations[@]}" -gt 0
policy_hash="$(sha256sum "$policy" | awk '{print $1}')"
lock_hash="$(sha256sum pnpm-lock.yaml | awk '{print $1}')"
build_id="$(printf '%s\n%s\n%s\n%s\n' "$sha" "$policy_hash" "${migrations[-1]}" "$lock_hash" | sha256sum | awk '{print $1}')"
node -e 'const fs=require("fs");fs.writeFileSync(process.argv[1],JSON.stringify({sourceCommit:process.argv[2],policyHash:process.argv[3],migrationCount:Number(process.argv[4]),migrationHead:process.argv[5],buildIdentity:process.argv[6],nodeVersion:process.version,pnpmVersion:process.argv[7],lockfileHash:process.argv[8]},null,2)+"\n")' "$stage/RELEASE_MANIFEST.json" "$sha" "$policy_hash" "${#migrations[@]}" "${migrations[-1]}" "$build_id" "$(pnpm --version)" "$lock_hash"
printf 'source_git_commit=%s\n' "$sha" > "$stage/SOURCE_REVISION.txt"
node -e 'const fs=require("fs");fs.writeFileSync(process.argv[1],JSON.stringify({generatedForCommit:process.argv[2],included:["tracked source selected by git archive","canonical compiled .build output","generated RELEASE_MANIFEST.json","generated SOURCE_REVISION.txt","generated SHA256SUMS.txt"],excluded:[".env",".env.* except .env.example","private keys","wallet/keypair files","API/RPC credentials","node_modules",".pnpm-store","runtime databases","SOURCE_GIT.bundle"]},null,2)+"\n")' "$stage/SECURITY_SANITIZATION.json" "$sha"
(
  cd "$stage"
  find . -type f ! -name 'SHA256SUMS.txt' -print0 | sort -z | xargs -0 sha256sum > SHA256SUMS.txt
)
"$stage/scripts/verify-release-integrity.sh" "$stage"
out="${1:-$root/LPForge_Production_${sha:0:12}.tar.gz}"
# The staged tree comes from `git archive` and therefore contains no .git data.
# Do not use --exclude-vcs here: it would remove tracked files such as
# .gitignore after SHA256SUMS has already covered them.
tar -C "$stage" --exclude='node_modules' --exclude='.pnpm-store' --exclude='*.swp' -czf "$out" .
# Do not pipe `tar` directly to `grep` under `pipefail`: grep may stop after a
# match and make tar exit with SIGPIPE even though the artifact is valid.
archive_listing="$stage/archive-file-list.txt"
tar -tzf "$out" > "$archive_listing"
grep -qx './RELEASE_MANIFEST.json' "$archive_listing"
grep -qx './SOURCE_REVISION.txt' "$archive_listing"
grep -qx './SHA256SUMS.txt' "$archive_listing"
grep -qx './SECURITY_SANITIZATION.json' "$archive_listing"
sha256sum "$out"
