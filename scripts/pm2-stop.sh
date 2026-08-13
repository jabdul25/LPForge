#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
pm2 stop lpforge-production
pm2 save
