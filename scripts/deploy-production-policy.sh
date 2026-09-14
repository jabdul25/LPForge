#!/usr/bin/env bash
# Explicit, operator-invoked deployment for a committed policy-template edit.
# It never watches files or deploys merely because a JSON file was saved.
set -euo pipefail

root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$root"
lpforge_home="${LPFORGE_HOME:-/root/systems/LPForge}"
dry_run=false
if [[ "${1:-}" == "--dry-run" ]]; then dry_run=true; shift; fi
[[ "$#" -eq 0 ]] || { echo 'Usage: ./scripts/deploy-production-policy.sh [--dry-run]' >&2; exit 2; }
template_dir="${LPFORGE_POLICY_TEMPLATE_DIR:-$root/release-policy-templates}"
runtime_dir="${LPFORGE_POLICY_RUNTIME_DIR:-$lpforge_home/policy}"
plan_file="$(mktemp)"
backup_dir="$(mktemp -d)"
bootstrap_dir=""
rollback_required=false
previous_release=""
requested_services=()
runtime_policy_files=(
  live-execution-policy.json
  pool-discovery-policy.json
  autonomous-entry-policy.json
  live-position-management-policy.json
  oor-lifecycle-policy.json
  live-exit-governor-policy.json
)

fail_stage="PRECHECK"
die(){ echo "LPFORGE_POLICY_DEPLOY_FAIL stage=${fail_stage} reason=$*" >&2; exit 1; }
cleanup(){
  status=$?
  if [[ "$status" -ne 0 && "$rollback_required" == true ]]; then
    echo "LPFORGE_POLICY_DEPLOY_ROLLBACK stage=${fail_stage}" >&2
    for name in "${runtime_policy_files[@]}"; do install -m 0644 "$backup_dir/$name" "$runtime_dir/$name"; done
    install -m 0644 "$backup_dir/runtime-release-identity.json" "$runtime_dir/runtime-release-identity.json"
    if [[ -n "$previous_release" && "${#requested_services[@]}" -gt 0 ]]; then
      (cd "$previous_release" && bash scripts/pm2-restart.sh "${requested_services[@]}") >&2 || echo 'LPFORGE_POLICY_DEPLOY_ROLLBACK_RESTART_FAILED' >&2
    fi
  fi
  rm -rf "$plan_file" "$backup_dir" ${bootstrap_dir:+"$bootstrap_dir"}
  exit "$status"
}
trap cleanup EXIT

[[ -d "$template_dir" && -d "$runtime_dir" ]] || die 'policy directories missing'
if [[ "$dry_run" == false ]]; then
  mapfile -t working_changes < <(git diff --name-only)
  mapfile -t staged_changes < <(git diff --cached --name-only)
  for changed in "${working_changes[@]}" "${staged_changes[@]}"; do
    [[ -z "$changed" || "$changed" == release-policy-templates/*.json ]] || die "only policy-template edits are allowed:${changed}"
  done
  if [[ "${#working_changes[@]}" -gt 0 || "${#staged_changes[@]}" -gt 0 ]]; then
    git add release-policy-templates
    git commit -m 'policy: production deployment update'
  fi
fi
for name in "${runtime_policy_files[@]}"; do
  [[ -f "$template_dir/$name" && -f "$runtime_dir/$name" ]] || die "policy missing:${name}"
done

fail_stage="DETECT_CHANGE"
node scripts/production-policy-deployment-plan.mjs "$template_dir" "$runtime_dir" >"$plan_file"
change_count="$(node -e 'const fs=require("fs");const p=JSON.parse(fs.readFileSync(process.argv[1],"utf8"));process.stdout.write(String(p.changes.length))' "$plan_file")"
[[ "$change_count" -gt 0 ]] || die 'no canonical runtime policy change detected'
mapfile -t requested_services < <(node -e 'const fs=require("fs");const p=JSON.parse(fs.readFileSync(process.argv[1],"utf8"));for(const x of p.services)console.log(x)' "$plan_file")
[[ "${#requested_services[@]}" -gt 0 ]] || die 'no affected services derived'
echo 'LPFORGE_POLICY_DEPLOY_CHANGE'
node -e 'const fs=require("fs");const p=JSON.parse(fs.readFileSync(process.argv[1],"utf8"));for(const c of p.changes)console.log(`${c.domain} ${c.file} ${c.previousHash.slice(0,12)} -> ${c.nextHash.slice(0,12)}`);console.log(`AFFECTED_SERVICES ${p.services.join(" ")}`)' "$plan_file"
while IFS= read -r changed_file; do diff -u "$runtime_dir/$changed_file" "$template_dir/$changed_file" || true; done < <(node -e 'const fs=require("fs");const p=JSON.parse(fs.readFileSync(process.argv[1],"utf8"));for(const c of p.changes)console.log(c.file)' "$plan_file")
if [[ "$dry_run" == false ]]; then
  for name in "${runtime_policy_files[@]}"; do cp -a "$runtime_dir/$name" "$backup_dir/$name"; done
  cp -a "$runtime_dir/runtime-release-identity.json" "$backup_dir/runtime-release-identity.json"
  previous_source="$(node -e 'const x=require(process.argv[1]);process.stdout.write(x.sourceCommit)' "$runtime_dir/runtime-release-identity.json")"
  previous_release="$lpforge_home/releases/$previous_source"
  [[ -d "$previous_release" ]] || die 'previous immutable release unavailable for rollback'
fi

fail_stage="SCHEMA_AND_INVARIANTS"
node --input-type=module -e 'const m=await import(process.argv[1]);m.loadDeploymentPolicyFile(process.argv[2]);' "$root/.build/packages/deployment-policy/src/index.js" "$template_dir/live-execution-policy.json"
node --input-type=module -e 'const m=await import(process.argv[1]);m.loadLiveExitGovernorPolicy(process.argv[2]);' "$root/.build/packages/live-exit-governor/src/index.js" "$template_dir/live-exit-governor-policy.json"
node --input-type=module -e 'const m=await import(process.argv[1]);m.parseDiscoveryPolicy(JSON.parse(await (await import("node:fs/promises")).readFile(process.argv[2],"utf8")));' "$root/.build/packages/pool-discovery/src/index.js" "$template_dir/pool-discovery-policy.json"
node --input-type=module -e 'const m=await import(process.argv[1]);m.loadAutonomousEntryPolicy(process.argv[2]);' "$root/.build/packages/phase6-swap-quote/src/index.js" "$template_dir/autonomous-entry-policy.json"
node --input-type=module -e 'const m=await import(process.argv[1]);m.loadLivePositionManagementPolicy(process.argv[2]);m.loadOorLifecyclePolicy(process.argv[3]);' "$root/.build/packages/live-position-management/src/index.js" "$template_dir/live-position-management-policy.json" "$template_dir/oor-lifecycle-policy.json"
if [[ "$dry_run" == true ]]; then
  echo "LPFORGE_POLICY_DEPLOY_DRY_RUN_PASS services=${requested_services[*]}"
  exit 0
fi

fail_stage="FOCUSED_VALIDATION"
test_files=(tests/central-runtime-config.test.mjs tests/runtime-release-identity.test.mjs)
for service in "${requested_services[@]}"; do
  case "$service" in
    production) test_files+=(tests/configurable-minimum-range-survival-policy.test.mjs tests/live-exit-governor.test.mjs tests/live-position-management.test.mjs) ;;
    execution) test_files+=(tests/phase6-autonomous-dispatch.test.mjs tests/min60-initial-range-policy.test.mjs) ;;
    discovery|discovery-learning) test_files+=(tests/phase3-evidence-range-alignment.test.mjs tests/discovery-learning-runtime-bounds.test.mjs) ;;
  esac
done
mapfile -t test_files < <(printf '%s\n' "${test_files[@]}" | sort -u)
node --test "${test_files[@]}"

fail_stage="BUILD_RELEASE"
source_sha="$(git rev-parse HEAD)"
archive="$root/LPForge_Production_${source_sha:0:12}.tar.gz"
[[ ! -e "$archive" ]] || die "release archive already exists:${archive}"
scripts/build-production-release.sh "$archive"

fail_stage="INSTALL"
bootstrap_dir="$(mktemp -d)"
tar -xzf "$archive" -C "$bootstrap_dir"
rollback_required=true
new_release="$(bash "$bootstrap_dir/scripts/install-production-release.sh" "$archive")"

fail_stage="RESTART_AND_WAIT"
(cd "$new_release" && bash scripts/pm2-restart.sh "${requested_services[@]}")
export LPFORGE_EXPECTED_RELEASE="$new_release"
for attempt in $(seq 1 12); do
  if pm2 jlist | node -e '
let input="";process.stdin.on("data",x=>input+=x).on("end",()=>{const rows=JSON.parse(input),wanted=process.argv.slice(1),map={production:"lpforge-production",execution:"lpforge-execution",telegram:"lpforge-telegram-operator",discovery:"lpforge-discovery","discovery-learning":"lpforge-discovery-learning"};process.exit(wanted.every(x=>{const row=rows.find(y=>y.name===map[x]);return row?.pm2_env?.status==="online"&&row.pm2_env.pm_cwd===process.env.LPFORGE_EXPECTED_RELEASE;})?0:1);});
' "${requested_services[@]}"; then break; fi
  [[ "$attempt" -lt 12 ]] || die 'affected services failed PM2 health wait'
  sleep 5
done

fail_stage="RUNTIME_VERIFY"
LPFORGE_EXPECTED_RELEASE="$new_release" LPFORGE_HOME="$lpforge_home" LPFORGE_RUNTIME_CONFIG_ENFORCED=true bash "$new_release/scripts/verify-release-integrity.sh" "$new_release"
node - "$plan_file" "$runtime_dir" "$new_release/RELEASE_MANIFEST.json" <<'NODE'
const fs=require('fs'),crypto=require('crypto');
const [planPath,runtime,manifestPath]=process.argv.slice(2),plan=JSON.parse(fs.readFileSync(planPath,'utf8')),manifest=JSON.parse(fs.readFileSync(manifestPath,'utf8'));
for(const change of plan.changes){const bytes=fs.readFileSync(`${runtime}/${change.file}`),hash=crypto.createHash('sha256').update(bytes).digest('hex');if(hash!==change.nextHash||manifest.runtimePolicyTemplateHashes?.[change.file]!==hash)process.exit(1);}
const live=JSON.parse(fs.readFileSync(`${runtime}/live-execution-policy.json`,'utf8'));
console.log(`LPFORGE_POLICY_DEPLOY_RUNTIME min=${live.range.minimumIncludedBins} max=${live.positionConstruction.maxInitialPositionWidthBins} release=${manifest.sourceCommit}`);
NODE
if [[ " ${requested_services[*]} " == *' production '* || " ${requested_services[*]} " == *' execution '* ]]; then
  terminal_output="$(cd "$new_release" && timeout 20 bash scripts/start-lpforge-service.sh terminal --once --plain)" || die 'terminal health verification failed'
  grep -q 'P7 HEALTHY' <<<"$terminal_output" || die 'P7 health verification failed'
  grep -Eq 'P6 EXECUTION[[:space:]]+READY' <<<"$terminal_output" || die 'P6 health verification failed'
fi

rollback_required=false
echo "LPFORGE_POLICY_DEPLOY_PASS release=${source_sha} services=${requested_services[*]}"
