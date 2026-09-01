import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {getProductionNewEntryEligiblePools,productionManagementPoolAddresses} from '../.build/packages/phase7-production-service/src/index.js';

const policyPath=new URL('../policies/live-execution-policy.json',import.meta.url).pathname;
const staticPool='EsR3gRxMtqt3bBhDDsuY3SFyYNYvYzszzG9KVYpcQfs7';
const dynamicPool='DYNAMIC_NON_POLICY_POOL';
const env={LPFORGE_DISCOVERY_OPERATOR_ENABLED:'true',LPFORGE_EXECUTION_POLICY_PATH:policyPath,LPFORGE_PRODUCTION_OPERATOR_MAX_POOLS:'10'};

test('static membership alone never seeds the canonical new-entry universe',async()=>{
 const pools=await getProductionNewEntryEligiblePools({listDiscoveryCandidates:async()=>[
  {poolAddress:staticPool,state:'QUALIFIED',tier:'A',payload:{}},
  {poolAddress:dynamicPool,state:'ACTIVE_CANDIDATE',tier:'A',payload:{}},
 ]},env,'static-negative');
 assert.equal(pools.includes(staticPool),false);
 assert.deepEqual(pools,[dynamicPool]);
});

test('dynamically admitted static and non-policy pools compete under identical eligibility semantics',async()=>{
 const pools=await getProductionNewEntryEligiblePools({listDiscoveryCandidates:async()=>[
  {poolAddress:staticPool,state:'ACTIVE_CANDIDATE',tier:'A',payload:{}},
  {poolAddress:dynamicPool,state:'ACTIVE_CANDIDATE',tier:'A',payload:{}},
  {poolAddress:'UNQUALIFIED',state:'QUALIFIED',tier:'A',payload:{}},
 ]},env,'dynamic-positive');
 assert.deepEqual(new Set(pools),new Set([staticPool,dynamicPool]));
});

test('policy/open pools remain management-visible without becoming new-entry candidates',async()=>{
 const management=productionManagementPoolAddresses(env,['OWNED_DYNAMIC_POOL']);
 assert.ok(management.includes(staticPool));
 assert.ok(management.includes('OWNED_DYNAMIC_POOL'));
 const pools=await getProductionNewEntryEligiblePools({listDiscoveryCandidates:async()=>[]},env,'management-only');
 assert.deepEqual(pools,[]);
});

test('global winner remains the only plan target and policy monitoring needs explicit healthcheck scope',()=>{
 const p7=fs.readFileSync(new URL('../packages/phase7-production-service/src/index.ts',import.meta.url),'utf8');
 const operator=fs.readFileSync(new URL('../apps/operator/src/main.ts',import.meta.url),'utf8');
 assert.match(p7,/eligiblePoolAddresses:newEntryPoolAddresses/);
 assert.match(p7,/poolAddress:winner\.poolAddress/);
 assert.doesNotMatch(p7,/winner\?\.poolAddress\s*\?\?\s*policy/);
 assert.match(operator,/LPFORGE_POLICY_HEALTHCHECK_POOL==='true'/);
 assert.match(operator,/globalSelection.*selectedCandidateId/s);
 assert.match(operator,/LPFORGE_GLOBAL_SELECTION_PROVENANCE_MISMATCH/);
});
