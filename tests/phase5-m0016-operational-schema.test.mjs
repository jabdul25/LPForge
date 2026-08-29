import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';
const sql=fs.readFileSync(new URL('../packages/db/migrations/M0016_phase5_operational_completion.sql',import.meta.url),'utf8');
test('M0016 persists forward-runtime, heartbeat, and devnet validation evidence',()=>{for(const table of ['operations.forward_cycles','operations.runtime_heartbeats','operations.devnet_validation_runs'])assert.match(sql,new RegExp(table.replace('.','\\.')));assert.match(sql,/PRIMARY KEY\(run_id,stage\)/);});
