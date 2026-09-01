import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {isPhase7SupersededReconciliationDebtArtifact} from '../.build/packages/db/src/index.js';
import {runPhase7RecoveryRuntimeTick} from '../.build/packages/phase7-live-runtime/src/index.js';

const authorityAt='2026-09-01T08:31:44.147Z';
const olderUnknown={planReconciliationStatus:'UNKNOWN',lifecycleStatus:'SOL_SETTLED',authoritativeLifecycleReconciliationStatus:'RECONCILED_CHAIN',planReconciliationObservedAt:'2026-09-01T00:17:47.636Z',authoritativeLifecycleReconciliationObservedAt:authorityAt,newerUnresolvedEffect:false};
const blocking=(overrides={})=>assert.equal(isPhase7SupersededReconciliationDebtArtifact({...olderUnknown,...overrides}),false);

test('P7 lifecycle-aware debt classification retains genuine debt and supersedes only authoritative terminal history',()=>{
  // BcH fixture: the retired parent UNKNOWN remains forensic evidence but is no longer active debt.
  assert.equal(isPhase7SupersededReconciliationDebtArtifact(olderUnknown),true);
  blocking({lifecycleStatus:'OPEN'});
  blocking({lifecycleStatus:'CLOSING'});
  blocking({authoritativeLifecycleReconciliationStatus:undefined});
  blocking({authoritativeLifecycleReconciliationStatus:'UNKNOWN'});
  blocking({authoritativeLifecycleReconciliationStatus:'FAIL'});
  blocking({newerUnresolvedEffect:true});
  blocking({planReconciliationObservedAt:'2026-09-01T09:00:00.000Z'});
  blocking({planReconciliationStatus:'MATCH'});
});

test('P7 with superseded history only does not enter RECOVER_ONLY',async()=>{
  const facts={previousCompletedCycleKeys:[],completedEconomicActionKeys:[],recoveryQueueCount:0,unknownSubmissionCount:0,unresolvedReconciliationDebt:0,supersededReconciliationHistoryCount:1,partialEntryRecoveryCount:0};
  const store={claimPhase7RuntimeLease:async()=>({generation:1}),loadPhase7RecoveryFacts:async()=>facts,insertPhase7RuntimeCycle:async()=>true};
  const result=await runPhase7RecoveryRuntimeTick({store,runtimeId:'prod',instanceId:'i',cycleKey:'c',now:'2026-09-01T09:00:00Z',leaseTtlMs:60000,restarted:false,control:{authorityMode:'OBSERVE_ONLY',healthStatus:'HEALTHY',newEconomicActionAllowed:false}});
  assert.equal(result.plan,'OBSERVE_ONLY');
  assert.equal(result.recoveryFacts.supersededReconciliationHistoryCount,1);
  assert.equal(result.recoveryFacts.unresolvedReconciliationDebt,0);
});

test('P7 production orchestration reaches global selection after the lifecycle-aware recovery gate',()=>{
  const source=fs.readFileSync(new URL('../packages/phase7-production-service/src/index.ts',import.meta.url),'utf8');
  const recoveryGate=source.indexOf('const recovery=await input.store.loadPhase7RecoveryFacts');
  const globalSelection=source.indexOf('globalSelection=await runProductionGlobalSelectionCycle');
  assert.ok(recoveryGate>=0);
  assert.ok(globalSelection>recoveryGate);
  assert.match(source,/recovery\.unresolvedReconciliationDebt>0/);
  assert.doesNotMatch(source,/supersededReconciliationHistoryCount>0/);
});
