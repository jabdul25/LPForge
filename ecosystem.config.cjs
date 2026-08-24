'use strict';
const path = require('node:path');
// PM2 itself may be installed under an older system Node. Services run through
// the verified release launcher with the supported production runtime; the
// launcher independently compares its actual version to RELEASE_MANIFEST.json.
const runtimePath=`/opt/node-v24.19.0-linux-x64/bin:${process.env.PATH??''}`;
module.exports = {
  apps: [{
    name: 'lpforge-production',
    cwd: __dirname,
    script: '/bin/bash',
    args: 'scripts/start-lpforge-service.sh production',
    exec_mode: 'fork',
    instances: 1,
    autorestart: true,
    watch: false,
    min_uptime: '30s',
    max_restarts: 10,
    restart_delay: 5000,
    exp_backoff_restart_delay: 100,
    kill_timeout: 15000,
    listen_timeout: 10000,
    time: true,
    merge_logs: true,
    out_file: path.join(__dirname, 'logs', 'lpforge-production.out.log'),
    error_file: path.join(__dirname, 'logs', 'lpforge-production.err.log'),
    env: { NODE_ENV: 'production', PATH: runtimePath, LPFORGE_PHASE3_QUALIFICATION_POLICY: 'candidate-primary-risk-adjusted-v1' }
  },{
    name: 'lpforge-execution',
    cwd: __dirname,
    script: '/bin/bash',
    args: 'scripts/start-lpforge-service.sh execution',
    exec_mode: 'fork',
    instances: 1,
    autorestart: false,
    watch: false,
    kill_timeout: 15000,
    time: true,
    merge_logs: true,
    out_file: path.join(__dirname, 'logs', 'lpforge-execution.out.log'),
    error_file: path.join(__dirname, 'logs', 'lpforge-execution.err.log'),
    env: { NODE_ENV: 'production', PATH: runtimePath }
  },{
    name: 'lpforge-discovery',
    cwd: __dirname,
    script: '/bin/bash',
    args: 'scripts/start-lpforge-service.sh discovery',
    exec_mode: 'fork',
    instances: 1,
    autorestart: true,
    watch: false,
    min_uptime: '30s',
    max_restarts: 10,
    restart_delay: 5000,
    exp_backoff_restart_delay: 100,
    kill_timeout: 15000,
    time: true,
    merge_logs: true,
    out_file: path.join(__dirname, 'logs', 'lpforge-discovery.out.log'),
    error_file: path.join(__dirname, 'logs', 'lpforge-discovery.err.log'),
    env: { NODE_ENV: 'production', PATH: runtimePath }
  },{
    name: 'lpforge-discovery-learning',
    cwd: __dirname,
    script: '/bin/bash',
    args: 'scripts/start-lpforge-service.sh discovery-learning',
    exec_mode: 'fork',
    instances: 1,
    autorestart: true,
    watch: false,
    min_uptime: '30s',
    max_restarts: 10,
    restart_delay: 5000,
    exp_backoff_restart_delay: 100,
    kill_timeout: 15000,
    time: true,
    merge_logs: true,
    out_file: path.join(__dirname, 'logs', 'lpforge-discovery-learning.out.log'),
    error_file: path.join(__dirname, 'logs', 'lpforge-discovery-learning.err.log'),
    env: { NODE_ENV: 'production', PATH: runtimePath }
  }]
};
