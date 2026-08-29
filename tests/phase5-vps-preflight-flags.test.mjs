import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';
const s=fs.readFileSync(new URL('../scripts/vps-preflight.sh',import.meta.url),'utf8');
test('VPS preflight checks the actual Phase 5 live/canary environment variable names',()=>{assert.match(s,/LIVE_SIGNING LPFORGE_LIVE_EXECUTION LPFORGE_MAINNET_CANARY/);assert.doesNotMatch(s,/LIVE_SIGNING LIVE_EXECUTION MAINNET_CANARY/);});
