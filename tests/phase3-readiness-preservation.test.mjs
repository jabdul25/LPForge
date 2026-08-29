import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {ACTIVE_EVIDENCE_LEASE_TIMEOUT_MS,isPhase3ReadyConsumptionPending,isLiveEvidenceLeaseActive,liveEvidenceLeaseReleaseReason,dynamicLiveEvidenceAdmissionCapacity,selectLiveEvidenceAdmissionCandidates} from '../.build/packages/db/src/index.js';
import {isPhase3ReadyProductionEvaluationCandidate,productionEvaluationPoolAddresses} from '../.build/packages/phase7-production-service/src/index.js';
const policy=new URL('../policies/live-execution-policy.json',import.meta.url).pathname;
const at='2026-08-22T10:00:00.000Z';
const payload=(readyAt='2026-08-22T09:59:00.000Z')=>({liveEvidencePhase3ConsumptionState:'PENDING',liveEvidencePhase3ReadyAt:readyAt,liveEvidenceLeaseStartedAt:'2026-08-22T09:30:00.000Z',liveEvidenceLeaseExpiresAt:'2026-08-22T10:15:00.000Z'});
test('Phase-3 readiness preserves a bounded ACTIVE lease until terminal economics',()=>{
 const p=payload(),lease={state:'ACTIVE_CANDIDATE',startedAt:p.liveEvidenceLeaseStartedAt,expiresAt:p.liveEvidenceLeaseExpiresAt,failureCount:0,eventPathEstimateFresh:true,phase3CurrentLiveReady:true};
 assert.equal(isPhase3ReadyConsumptionPending(p,at),true);
 assert.equal(isLiveEvidenceLeaseActive(lease,at),true);
 assert.equal(liveEvidenceLeaseReleaseReason(lease,at),undefined);
 assert.equal(liveEvidenceLeaseReleaseReason({...lease,phase3Status:'NO_TRADE'},at),'LIVE_EVIDENCE_LEASE_TERMINAL_PHASE3');
 assert.equal(liveEvidenceLeaseReleaseReason({...lease,phase3Status:'ENTRY_READY'},at),'LIVE_EVIDENCE_LEASE_TERMINAL_PHASE3');
 assert.equal(liveEvidenceLeaseReleaseReason(lease,new Date(Date.parse(p.liveEvidenceLeaseStartedAt)+ACTIVE_EVIDENCE_LEASE_TIMEOUT_MS).toISOString()),'LIVE_EVIDENCE_LEASE_TIMEOUT');
});
test('ready dynamic candidates retain active slots and deterministic production urgency',async()=>{
 const candidates=[
  {poolAddress:'ready-old',state:'ACTIVE_CANDIDATE',tier:'A',payload:payload('2026-08-22T09:55:00.000Z'),priorityScore:1,lastSeenAt:at},
  {poolAddress:'ready-new',state:'ACTIVE_CANDIDATE',tier:'A',payload:payload('2026-08-22T09:58:00.000Z'),priorityScore:1,lastSeenAt:at},
  {poolAddress:'higher-ranked-waiter',state:'QUALIFIED',tier:'A',payload:{},priorityScore:999,lastSeenAt:at},
 ];
 assert.equal(isPhase3ReadyProductionEvaluationCandidate(candidates[0],at),true);
 const selected=selectLiveEvidenceAdmissionCandidates(candidates.map((x,i)=>({...x,rank:i,firstSeenAt:at,matureForPhase3:false,phase3Terminal:false,evidenceLeaseActive:x.state==='ACTIVE_CANDIDATE'})),2);
 assert.deepEqual(selected.map(x=>x.poolAddress).sort(),['ready-new','ready-old']);
 const pools=await productionEvaluationPoolAddresses({listDiscoveryCandidates:async()=>candidates},{LPFORGE_DISCOVERY_OPERATOR_ENABLED:'true',LPFORGE_EXECUTION_POLICY_PATH:policy,LPFORGE_PRODUCTION_OPERATOR_MAX_POOLS:'1'},'x');
 assert.ok(pools.includes('ready-old'));assert.equal(pools.includes('ready-new'),false);assert.equal(pools.includes('higher-ranked-waiter'),false);
});
test('static policy reads write canonical LIVE_OBSERVED evidence without using dynamic capacity',()=>{
 const operator=fs.readFileSync(new URL('../apps/operator/src/main.ts',import.meta.url),'utf8');
 const active=fs.readFileSync(new URL('../packages/active-candidate-evidence/src/index.ts',import.meta.url),'utf8');
 const db=fs.readFileSync(new URL('../packages/db/src/index.ts',import.meta.url),'utf8');
 assert.match(operator,/productionPolicyPool:true/);assert.match(operator,/sourceProvider:'OPERATOR_METEORA_API\+RPC'/);
 assert.match(active,/summarizePhase3RecentLiveObservations/);assert.match(active,/hasPhase3FreshHistoricalEvidence/);
 assert.match(db,/liveEvidencePhase3ConsumptionState','PENDING/);assert.match(db,/current_state='ACTIVE_CANDIDATE' AND payload->>'liveEvidencePhase3ConsumptionState'='PENDING'/);
 assert.equal(dynamicLiveEvidenceAdmissionCapacity({serviceableCapacity:2,staticPolicyPoolCount:5}),2);
});
test('WARMING cannot complete a ready lease through the durable outcome path',()=>{
 const db=fs.readFileSync(new URL('../packages/db/src/index.ts',import.meta.url),'utf8');
 const body=db.slice(db.indexOf('async recordPostEvidenceEvaluationOutcome'),db.indexOf('async markDiscoveryPoolsStale'));
 assert.ok(body.includes("phase3Status!=='ENTRY_READY'&&v.phase3Status!=='NO_TRADE')return"));
 assert.ok(body.indexOf("phase3Status!=='ENTRY_READY'&&v.phase3Status!=='NO_TRADE')return")<body.indexOf('LIVE_EVIDENCE_LEASE_TERMINAL_PHASE3'));
});
