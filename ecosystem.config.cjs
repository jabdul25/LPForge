'use strict';
const path = require('node:path');
module.exports = {
  apps: [{
    name: 'lpforge-production',
    cwd: __dirname,
    script: process.execPath,
    args: '--env-file=.env --enable-source-maps .build/apps/production/src/main.js start',
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
    env: { NODE_ENV: 'production' }
  },{
    name: 'lpforge-execution',
    cwd: __dirname,
    script: process.execPath,
    args: '--env-file=.env.execution --enable-source-maps .build/apps/execution/src/main.js start',
    exec_mode: 'fork',
    instances: 1,
    autorestart: false,
    watch: false,
    kill_timeout: 15000,
    time: true,
    merge_logs: true,
    out_file: path.join(__dirname, 'logs', 'lpforge-execution.out.log'),
    error_file: path.join(__dirname, 'logs', 'lpforge-execution.err.log'),
    env: { NODE_ENV: 'production' }
  }]
};
