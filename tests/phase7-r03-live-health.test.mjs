import test from 'node:test';import assert from 'node:assert/strict';
import {collectPhase7LiveHealthObservations} from '../.build/packages/phase7-live-health/src/index.js';
import {assessPhase7Health,defaultPhase7HealthPolicy} from '../.build/packages/phase7-health/src/index.js';
const at='2026-08-13T01:00:00.000Z';
const goodStore={health:async()=>true,loadPhase7HealthFacts:async()=>({latestDecisionAt:'2026-08-13T00:59:30.000Z',unknownSubmissionCount:0,unresolvedReconciliationDebt:0,activeExecutionJournalCount:0,openCanarySessionCount:0})};
test('P7-R03 live health collector produces all seven operational domains from probes and DB state',async()=>{const obs=await collectPhase7LiveHealthObservations({assessmentAt:at,poolAddress:'pool',rpc:{getSlot:async()=>123n},dataApi:{getPool:async()=>({address:'pool'})},store:goodStore});assert.deepEqual(obs.map(x=>x.domain).sort(),['DATABASE','DECISION','EXECUTION','METEORA_API','PORTFOLIO','RECONCILIATION','RPC']);const health=assessPhase7Health(obs,defaultPhase7HealthPolicy,at);assert.equal(health.status,'HEALTHY');assert.equal(health.newEntriesAllowed,true);});
test('P7-R03 unknown submission and reconciliation debt are critical live health evidence',async()=>{const store={...goodStore,loadPhase7HealthFacts:async()=>({latestDecisionAt:'2026-08-13T00:59:30.000Z',unknownSubmissionCount:1,unresolvedReconciliationDebt:2,activeExecutionJournalCount:1,openCanarySessionCount:0})};const obs=await collectPhase7LiveHealthObservations({assessmentAt:at,poolAddress:'pool',rpc:{getSlot:async()=>123n},dataApi:{getPool:async()=>({address:'pool'})},store});const health=assessPhase7Health(obs,defaultPhase7HealthPolicy,at);assert.equal(health.status,'CRITICAL');assert.ok(health.reasonCodes.includes('P7_LIVE_UNKNOWN_SUBMISSION'));assert.ok(health.reasonCodes.includes('P7_LIVE_RECONCILIATION_DEBT'));});
test('P7-R03 RPC failure is critical while Data API failure degrades',async()=>{const obs=await collectPhase7LiveHealthObservations({assessmentAt:at,poolAddress:'pool',rpc:{getSlot:async()=>{throw new Error('rpc')}},dataApi:{getPool:async()=>{throw new Error('api')}},store:goodStore});assert.equal(obs.find(x=>x.domain==='RPC')?.status,'CRITICAL');assert.equal(obs.find(x=>x.domain==='METEORA_API')?.status,'DEGRADED');assert.equal(assessPhase7Health(obs,defaultPhase7HealthPolicy,at).status,'CRITICAL');});
test('P7-R03 genuinely aged decision evidence remains a hard revocation',async()=>{const staleStore={...goodStore,loadPhase7HealthFacts:async()=>({latestDecisionAt:'2026-08-13T00:57:59.999Z',unknownSubmissionCount:0,unresolvedReconciliationDebt:0,activeExecutionJournalCount:0,openCanarySessionCount:0})};const obs=await collectPhase7LiveHealthObservations({assessmentAt:at,poolAddress:'pool',rpc:{getSlot:async()=>123n},dataApi:{getPool:async()=>({address:'pool'})},store:staleStore});const health=assessPhase7Health(obs,defaultPhase7HealthPolicy,at);assert.equal(obs.find(x=>x.domain==='DECISION')?.status,'DEGRADED');assert.equal(health.status,'CRITICAL');assert.ok(health.reasonCodes.includes('P7_HEALTH_DECISION_STALE'));assert.ok(health.reasonCodes.includes('P7_LIVE_DECISION_AGING'));});
test('P7-R03 recovery-only health retains strict non-decision checks while deferring the intentionally skipped entry decision',async()=>{const staleStore={...goodStore,loadPhase7HealthFacts:async()=>({latestDecisionAt:'2026-08-13T00:00:00.000Z',unknownSubmissionCount:0,unresolvedReconciliationDebt:0,activeExecutionJournalCount:0,openCanarySessionCount:0})};const obs=await collectPhase7LiveHealthObservations({assessmentAt:at,poolAddress:'pool',rpc:{getSlot:async()=>123n},dataApi:{getPool:async()=>({address:'pool'})},store:staleStore,decisionFreshnessRequired:false});const decision=obs.find(x=>x.domain==='DECISION');assert.equal(decision?.status,'HEALTHY');assert.deepEqual(decision?.reasonCodes,['P7_LIVE_DECISION_DEFERRED_FOR_RECOVERY']);assert.equal(assessPhase7Health(obs,defaultPhase7HealthPolicy,at).status,'HEALTHY');});

// The P7 DECISION domain is a producer-daemon heartbeat, not a lease on one
// rotating candidate. A stale non-selected pool must not revoke production
// while the producer is durably emitting fresh forward cycles. A fully
// completed, empty global selection is also a real NO_TRADE decision; it is
// the only zero-candidate selection that may satisfy the heartbeat.
test('P7-R03 decision-health persistence accepts global forward cycles or a completed empty global NO_TRADE selection, never a partial/candidate-bearing selection',async()=>{
  const fs=await import('node:fs');
  const source=fs.readFileSync(new URL('../packages/db/src/index.ts',import.meta.url),'utf8');
  const method=source.slice(source.indexOf('async loadPhase7HealthFacts(poolAddress)'),source.indexOf('async loadPhase7DriftFacts'));
  assert.match(method,/SELECT observed_at FROM operations\.forward_cycles/);
  assert.match(method,/FROM execution\.production_global_selection_cycles/);
  assert.match(method,/coverage_state='COMPLETE'/);
  assert.match(method,/outcome='GLOBAL_NO_TRADE'/);
  assert.match(method,/eligible_pool_count=0/);
  assert.match(method,/evaluated_pool_count=0/);
  assert.match(method,/candidate_pool_count=0/);
  assert.match(method,/UNION ALL/);
  assert.doesNotMatch(method,/FROM operations\.forward_cycles WHERE pool_address=\$1/);
});
