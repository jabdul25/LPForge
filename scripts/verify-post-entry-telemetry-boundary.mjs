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
];
for(const file of forbidden){
  const source=await readFile(file,'utf8');
  if(source.includes('post-entry-telemetry'))throw new Error(`POST_ENTRY_TELEMETRY_FORBIDDEN_CONSUMER:${file}`);
}
const recorder=await readFile('apps/discovery-learning/src/post-entry-telemetry-capture.ts','utf8');
if(!recorder.includes("packages/post-entry-telemetry"))throw new Error('POST_ENTRY_TELEMETRY_RECORDER_IMPORT_MISSING');
if(!recorder.includes('RESEARCH_ONLY_NO_POLICY_MUTATION'))throw new Error('POST_ENTRY_TELEMETRY_RESEARCH_AUTHORITY_MISSING');
const migration=await readFile('packages/db/migrations/M0049_post_entry_state_telemetry.sql','utf8');
for(const required of ['post_entry_telemetry_activation','post_entry_telemetry_episodes','post_entry_telemetry_observations','telemetry_manifest','BEFORE UPDATE OR DELETE','REVOKE UPDATE, DELETE'])if(!migration.includes(required))throw new Error(`POST_ENTRY_TELEMETRY_INTEGRITY_MISSING:${required}`);
console.log('POST_ENTRY_TELEMETRY_BOUNDARY_OK');
