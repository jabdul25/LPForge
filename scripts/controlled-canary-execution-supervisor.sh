#!/usr/bin/env bash
# One-shot host supervisor for the already-built P7 watch and P6 execution
# binaries.  It has no trading logic: P7 persists a claimed, provenance-bound
# plan; P6 atomically claims, simulates, and (only if all existing gates pass)
# executes it.  A durable marker prevents this supervisor from ever launching
# a second dispatch attempt for the controlled canary.
set -euo pipefail

release_dir=${LPFORGE_CANARY_RELEASE_DIR:?LPFORGE_CANARY_RELEASE_DIR_REQUIRED}
execution_env=${LPFORGE_CANARY_EXECUTION_ENV_FILE:?LPFORGE_CANARY_EXECUTION_ENV_FILE_REQUIRED}
postgres_container=${LPFORGE_CANARY_POSTGRES_CONTAINER:?LPFORGE_CANARY_POSTGRES_CONTAINER_REQUIRED}
database_name=${LPFORGE_CANARY_DATABASE_NAME:?LPFORGE_CANARY_DATABASE_NAME_REQUIRED}
network_name=${LPFORGE_CANARY_NETWORK:?LPFORGE_CANARY_NETWORK_REQUIRED}
evidence_dir=${LPFORGE_CANARY_EVIDENCE_DIR:?LPFORGE_CANARY_EVIDENCE_DIR_REQUIRED}
runtime_id=${LPFORGE_P7_RUNTIME_ID:-lpforge-live-validation}
poll_seconds=${LPFORGE_CANARY_POLL_SECONDS:-1}
marker_file="$evidence_dir/controlled-canary-dispatch-attempted"
lock_file="$evidence_dir/controlled-canary-supervisor.lock"

# This supervisor can eventually launch the execution child, so it must prove
# the mounted release before even watching for an eligible plan. The binary
# path is deployment plumbing, not an identity source: the artifact verifier
# checks the actual Node version against RELEASE_MANIFEST.json.
runtime_node_bin=${LPFORGE_RUNTIME_NODE_BIN:-/opt/node-v24.19.0-linux-x64/bin/node}
[[ -x "$runtime_node_bin" ]] || runtime_node_bin=$(command -v node)
export PATH="$(dirname "$runtime_node_bin"):$PATH"
(
  cd "$release_dir"
  LPFORGE_RUNTIME_RELEASE_VERIFY=true "$runtime_node_bin" scripts/verify-runtime-release-identity.mjs
)

mkdir -p "$evidence_dir"
chmod 0700 "$evidence_dir"
exec 9>"$lock_file"
flock -n 9 || exit 0

if [[ -e "$marker_file" ]]; then
  exit 0
fi

query() {
  docker exec "$postgres_container" psql -U postgres -d "$database_name" -At -v ON_ERROR_STOP=1 -c "$1"
}

while :; do
  # An OPEN plan is eligible only while both its Phase-4 expiry and the
  # preceding P7 decision remain fresh.  The execution claim guard repeats
  # these checks transactionally; this is merely the host admission boundary.
  plan_id=$(query "SELECT p.plan_id FROM execution.transaction_plans p JOIN execution.intents i ON i.intent_id=p.intent_id WHERE p.state='PLANNED' AND i.action='OPEN' AND p.expires_at>now() ORDER BY p.created_at LIMIT 1" | head -n1 || true)
  control_ok=$(query "SELECT CASE WHEN authority_mode='PRODUCTION' AND health_status='HEALTHY' AND safety_mode='NORMAL' AND drift_status<>'BLOCK' AND new_economic_action_allowed AND observed_at>now()-interval '60 seconds' THEN 'yes' ELSE 'no' END FROM operations.phase7_control_decisions WHERE runtime_id='${runtime_id//\'/\'\'}' ORDER BY observed_at DESC LIMIT 1" | head -n1 || true)
  if [[ -n "$plan_id" && "$control_ok" == 'yes' ]]; then
    # Mark before starting P6.  If the host/process fails during or after
    # submission, recovery and reconciliation—not another dispatch—own the
    # next action.
    umask 077
    printf '%s\n' "plan_id=$plan_id" >"$marker_file"
    docker run --rm --name "lpforge-live-execution-canary-${plan_id:0:12}" \
      --network "$network_name" \
      --env-file "$execution_env" \
      -e LPFORGE_P7_RUNTIME_ID="$runtime_id" \
      -v "$release_dir:/workspace:ro" \
      -w /workspace \
      node:24-bookworm node --enable-source-maps .build/apps/execution/src/main.js dispatch-once \
      >"$evidence_dir/controlled-canary-dispatch-${plan_id}.json" 2>&1
    exit 0
  fi
  sleep "$poll_seconds"
done
