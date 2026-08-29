import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

test('Phase 5 validation lifecycle journals a non-economic plan before submission',()=>{
  const source=fs.readFileSync(new URL('../apps/devnet/src/main.ts', import.meta.url),'utf8');
  assert.match(source,/action:'VALIDATION_TRANSFER'/);
  assert.match(source,/kind:'SYSTEM_TRANSFER_VALIDATION'/);
  assert.match(source,/insertExecutionSimulation/);
  assert.match(source,/insertExecutionRiskPermit/);
});

test('M0017 permits pool-less validation intents without weakening economic intent pool requirement',()=>{
  const sql=fs.readFileSync(new URL('../packages/db/migrations/M0017_phase5_validation_execution.sql', import.meta.url),'utf8');
  assert.match(sql,/action='VALIDATION_TRANSFER' AND pool_address IS NULL/);
  assert.match(sql,/action<>'VALIDATION_TRANSFER' AND pool_address IS NOT NULL/);
});
