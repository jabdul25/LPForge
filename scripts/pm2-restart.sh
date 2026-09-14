#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
release_dir="$PWD"
# Policy/service dependency map: live-execution policy is consumed by
# production (P7/P4), execution (P6), and discovery's evidence envelope.
# Telegram is an operator-intent transport, not trading-policy authority.
declare -A services=(
  [production]=lpforge-production
  [execution]=lpforge-execution
  [telegram]=lpforge-telegram-operator
  [discovery]=lpforge-discovery
  [discovery-learning]=lpforge-discovery-learning
)
requested=("$@")
if [[ "${requested[0]:-}" == "--validate" ]]; then
  requested=("${requested[@]:1}")
  [[ "${#requested[@]}" -gt 0 ]] || { echo 'LPFORGE_PM2_SERVICE_REQUIRED' >&2; exit 2; }
  for name in "${requested[@]}"; do [[ -n "${services[$name]:-}" ]] || { echo "LPFORGE_PM2_SERVICE_UNKNOWN:${name}" >&2; exit 2; }; done
  printf '%s\n' "${requested[@]}"
  exit 0
fi
# shellcheck source=runtime-config-paths.sh
source "$release_dir/scripts/runtime-config-paths.sh"
# No arguments retains the full-system release behavior. Named services use a
# narrow immutable-release replacement and must be explicit known aliases.
if [[ "${#requested[@]}" -eq 0 ]]; then requested=(production execution telegram discovery discovery-learning); fi
for name in "${requested[@]}"; do [[ -n "${services[$name]:-}" ]] || { echo "LPFORGE_PM2_SERVICE_UNKNOWN:${name}" >&2; exit 2; }; done
# PM2 `restart` retains the registered cwd. Replace only the requested
# registrations so unrequested services cannot silently move releases.
for name in "${requested[@]}"; do pm2 delete "${services[$name]}" || true; done
for name in "${requested[@]}"; do pm2 start ecosystem.config.cjs --only "${services[$name]}"; done
pm2 save
pm2 jlist | node -e '
let input="";process.stdin.on("data",chunk=>input+=chunk).on("end",()=>{
  const wanted=process.argv.slice(1), map={production:"lpforge-production",execution:"lpforge-execution",telegram:"lpforge-telegram-operator",discovery:"lpforge-discovery","discovery-learning":"lpforge-discovery-learning"};
  const rows=JSON.parse(input);let failed=false;
  for(const alias of wanted){const row=rows.find(value=>value.name===map[alias]);if(!row||row.pm2_env?.status!=="online"){console.error(`LPFORGE_PM2_SERVICE_OFFLINE:${alias}`);failed=true;}else console.log(`${alias}:${row.pm2_env.pm_cwd}`);}
  process.exit(failed?1:0);
});
' "${requested[@]}"
