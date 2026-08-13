#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
[[ -f .env ]] || { echo 'ERROR: .env missing.' >&2; exit 1; }
pm2 restart ecosystem.config.cjs --only lpforge-production --update-env
pm2 save
pm2 status lpforge-production
