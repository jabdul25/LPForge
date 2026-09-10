import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';

test('M0079 defines a provider-wide, priority-aware Data API permit authority',async()=>{
  const sql=await readFile(new URL('../packages/db/migrations/M0079_shared_data_api_coordinator.sql',import.meta.url),'utf8');
  for(const token of ['data_api_provider_budget_state','data_api_provider_metrics','acquire_data_api_permit','report_data_api_pressure','FOR UPDATE','P0_POSITION_PROTECTION','P1_PRODUCTION_DECISION','P2_DISCOVERY_CURRENT','P3_RESEARCH_BACKFILL'])assert.match(sql,new RegExp(token));
});

test('Data API provider identity is hashed and callers declare a non-default role',async()=>{
  const source=await readFile(new URL('../packages/data-api/src/index.ts',import.meta.url),'utf8');
  assert.match(source,/createHash\('sha256'\)/);assert.match(source,/acquire_data_api_permit/);assert.match(source,/deadlineAt/);
  for(const file of ['apps/operator/src/main.ts','apps/discovery/src/main.ts','apps/discovery-learning/src/main.ts','packages/phase7-production-service/src/index.ts']){
    const value=await readFile(new URL('../'+file,import.meta.url),'utf8');assert.match(value,/priority:\s*'P[0-3]_/);
  }
});
