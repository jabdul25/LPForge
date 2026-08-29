import { readFile } from 'node:fs/promises';

const forbidden=[
  'apps/operator/src/main.ts','apps/shadow/src/main.ts','apps/paper/src/main.ts',
  'apps/execution/src/main.ts','apps/production/src/main.ts','apps/discovery/src/main.ts',
  'packages/opportunity/src/index.ts','packages/candidate-ranking/src/index.ts',
  'packages/thesis/src/index.ts','packages/entry-intelligence/src/index.ts',
  'packages/rangeforge/src/index.ts','packages/phase7-production-service/src/index.ts',
];
for(const file of forbidden){
  const source=await readFile(file,'utf8');
  if(source.includes('inventory-forecast-v2'))throw new Error('INVENTORY_FORECAST_V2_FORBIDDEN_AUTHORITY_CONSUMER:'+file);
}
const recorder=await readFile('apps/discovery-learning/src/inventory-forecast-v2-capture.ts','utf8');
for(const required of ['packages/inventory-forecast-v2','RESEARCH_ONLY_NO_POLICY_MUTATION','planProspectiveInventoryForecastV2','loadOperationalHistory'])if(!recorder.includes(required))throw new Error('INVENTORY_FORECAST_V2_RECORDER_REQUIREMENT_MISSING:'+required);
const model=await readFile('packages/inventory-forecast-v2/src/index.ts','utf8');
for(const required of ['deriveCapitalConstrainedForwardPosition','forwardV2ValueLamports','SOURCE_TIMESTAMP_UNVERIFIED','FORECAST_UNAVAILABLE','INVENTORY_FORECAST_V2_MODEL_VERSION'])if(!model.includes(required))throw new Error('INVENTORY_FORECAST_V2_MODEL_REQUIREMENT_MISSING:'+required);
if(model.includes('matureFrozenPhase3ForwardOutcome'))throw new Error('INVENTORY_FORECAST_V2_OUTCOME_LOOKAHEAD_DEPENDENCY');
const migration=await readFile('packages/db/migrations/M0052_inventory_forecast_v2_prospective_shadow.sql','utf8');
for(const required of ['inventory_forecast_v2_activation','inventory_forecast_v2_predictions','inventory_forecast_v2_manifest','PRE_ACTIVATION_NOT_APPLICABLE','BEFORE UPDATE OR DELETE','REVOKE UPDATE, DELETE'])if(!migration.includes(required))throw new Error('INVENTORY_FORECAST_V2_INTEGRITY_MISSING:'+required);
console.log('INVENTORY_FORECAST_V2_SHADOW_BOUNDARY_OK');
