import { readFile } from 'node:fs/promises';

const forbidden=[
  'apps/operator/src/main.ts',
  'apps/shadow/src/main.ts',
  'apps/paper/src/main.ts',
  'apps/execution/src/main.ts',
  'apps/production/src/main.ts',
  'apps/discovery/src/main.ts',
  'packages/opportunity/src/index.ts',
  'packages/candidate-ranking/src/index.ts',
  'packages/thesis/src/index.ts',
  'packages/entry-intelligence/src/index.ts',
  'packages/rangeforge/src/index.ts',
];
for(const file of forbidden){
  const source=await readFile(file,'utf8');
  if(source.includes('market-context-telemetry'))throw new Error('M0050_FORBIDDEN_CONSUMER:'+file);
}
const recorder=await readFile('apps/discovery-learning/src/market-context-telemetry-capture.ts','utf8');
for(const required of ['packages/market-context-telemetry','RESEARCH_ONLY_NO_POLICY_MUTATION','planProspectiveMarketContextSnapshot'])if(!recorder.includes(required))throw new Error('M0050_RECORDER_REQUIREMENT_MISSING:'+required);
const migration=await readFile('packages/db/migrations/M0050_prospective_market_context_telemetry.sql','utf8');
for(const required of ['market_context_telemetry_activation','market_context_telemetry_snapshots','market_context_telemetry_facts','market_context_telemetry_manifest','PRE_ACTIVATION_NOT_APPLICABLE','BEFORE UPDATE OR DELETE','REVOKE UPDATE, DELETE'])if(!migration.includes(required))throw new Error('M0050_INTEGRITY_MISSING:'+required);
console.log('M0050_MARKET_CONTEXT_TELEMETRY_BOUNDARY_OK');
