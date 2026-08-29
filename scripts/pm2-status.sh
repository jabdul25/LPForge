#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
pm2 status lpforge-production lpforge-execution lpforge-discovery lpforge-discovery-learning
node --env-file=.env --enable-source-maps .build/apps/production/src/main.js status
