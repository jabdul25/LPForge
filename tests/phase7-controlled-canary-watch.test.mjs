import test from 'node:test';
import assert from 'node:assert/strict';
import {P7_CONTROLLED_CANARY_CLAIM_FRESHNESS_BUDGET_MS,controlledCanaryRevokedApprovalIds,phase7BoundedDecisionHealthProbePoolAddresses,phase7DecisionHealthPoolAddress,phase7DecisionHealthProbePoolAddresses,phase7NextDecisionHealthPoolAddress,phase7VerifiedDecisionHealthPoolAddress,resolveControlledCanaryWatch} from '../.build/packages/phase7-production-service/src/index.js';

const now='2026-08-20T12:00:00.000Z';
const env={
  LPFORGE_P7_MODE:'OBSERVE_ONLY',
  LPFORGE_P7_CONTROLLED_CANARY_WATCH_ENABLED:'true',
  LPFORGE_P7_CONTROLLED_CANARY_APPROVED_BY:'controlled-test-operator',
  LPFORGE_P7_CONTROLLED_CANARY_MAX_POSITIONS:'1',
  LPFORGE_P7_CONTROLLED_CANARY_MAX_LP_CAPITAL_LAMPORTS:'30000000',
};
const portfolio={openPositions:0,pendingExecutionCount:0,pendingReservedLamports:0n,unresolvedReconciliationDebt:0};
const authorized={entryEvaluationId:'entry-live',thesisId:'thesis-live',poolAddress:'pool-live',observedAt:now,expiresAt:'2026-08-20T12:04:00.000Z',confidence:.8,reasonCodes:['ENTRY_TIMING_APPROVED'],payload:{}};

test('controlled canary watch never promotes without a fresh Phase-4 authorization',()=>{
  const result=resolveControlledCanaryWatch({env,now,portfolio});
  assert.equal(result.activate,false);
  assert.ok(result.reasonCodes.includes('P7_CONTROLLED_CANARY_NO_FRESH_AUTHORIZATION'));
});

test('controlled canary watch refuses expired or waiting Phase-4 records',()=>{
  const expired=resolveControlledCanaryWatch({env,now,portfolio,authorization:{...authorized,expiresAt:'2026-08-20T11:59:59.000Z'}});
  assert.equal(expired.activate,false);
  assert.ok(expired.reasonCodes.includes('P7_CONTROLLED_CANARY_AUTHORIZATION_EXPIRED'));
  const waiting=resolveControlledCanaryWatch({env,now,portfolio,authorization:{...authorized,reasonCodes:['ENTRY_TIMING_APPROVED','WAIT_ECONOMIC_UNCERTAINTY']}});
  assert.equal(waiting.activate,false);
  assert.ok(waiting.reasonCodes.includes('P7_CONTROLLED_CANARY_AUTHORIZATION_NOT_CLEAN'));
});

test('controlled canary watch promotes only one clean fresh authorization with the fixed envelope',()=>{
  const result=resolveControlledCanaryWatch({env,now,portfolio,authorization:authorized,decisionObservedAt:'2026-08-20T11:59:30.000Z'});
  assert.equal(result.activate,true);
  assert.equal(result.approval?.action,'PROMOTE_PRODUCTION');
  assert.equal(result.approval?.approvalId,'canary-watch-entry-live');
  assert.equal(result.approval?.expiresAt,'2026-08-20T12:01:00.000Z');
});

test('controlled canary watch refuses source evidence that cannot survive the bounded claim path',()=>{
  const nearExpiry=new Date(Date.parse(now)-(120_000-P7_CONTROLLED_CANARY_CLAIM_FRESHNESS_BUDGET_MS+1)).toISOString();
  const result=resolveControlledCanaryWatch({env,now,portfolio,authorization:authorized,decisionObservedAt:nearExpiry});
  assert.equal(result.activate,false);
  assert.ok(result.reasonCodes.includes('P7_CONTROLLED_CANARY_DECISION_FRESHNESS_INSUFFICIENT'));
});

test('P7 decision freshness follows the prior probe target and carries the next target forward',()=>{
  assert.equal(phase7DecisionHealthPoolAddress({smokePoolAddress:'smoke',priorControlPayload:{decisionHealthPoolAddress:'canary-pool'}}),'canary-pool');
  assert.equal(phase7DecisionHealthPoolAddress({smokePoolAddress:'smoke',priorControlPayload:{}}),'smoke');
  assert.equal(phase7NextDecisionHealthPoolAddress({fallbackPoolAddress:'smoke',probePoolAddresses:['first','last']}),'last');
  assert.equal(phase7NextDecisionHealthPoolAddress({fallbackPoolAddress:'smoke',probePoolAddresses:[]}),'smoke');
});

test('P7 bounds a serialized decision producer to one deterministic pool per cycle',()=>{
  const pools=['pool-a','pool-b','pool-c'];
  assert.deepEqual(phase7BoundedDecisionHealthProbePoolAddresses({fallbackPoolAddress:'smoke',evaluationPoolAddresses:pools}),['pool-a']);
  assert.deepEqual(phase7BoundedDecisionHealthProbePoolAddresses({fallbackPoolAddress:'smoke',priorControlPayload:{decisionHealthPoolAddress:'pool-a'},evaluationPoolAddresses:pools}),['pool-b']);
  assert.deepEqual(phase7BoundedDecisionHealthProbePoolAddresses({fallbackPoolAddress:'smoke',priorControlPayload:{decisionHealthPoolAddress:'pool-c'},evaluationPoolAddresses:pools}),['pool-a']);
  assert.deepEqual(phase7BoundedDecisionHealthProbePoolAddresses({fallbackPoolAddress:'smoke',evaluationPoolAddresses:[]}),['smoke']);
});

test('P7 health uses the newest persisted decision from the exact prior probe set, never a merely scheduled target',()=>{
  const base={smokePoolAddress:'smoke',priorControlPayload:{decisionHealthPoolAddress:'missing',decisionHealthProbePoolAddresses:['early','late','missing']},priorControlObservedAt:'2026-08-20T12:00:00.000Z'};
  assert.deepEqual(phase7DecisionHealthProbePoolAddresses(base),['early','late','missing']);
  assert.deepEqual(phase7VerifiedDecisionHealthPoolAddress({...base,latestDecisionAtByPool:{early:'2026-08-20T12:00:00.001Z',late:'2026-08-20T12:00:20.000Z',missing:'2026-08-20T11:59:59.999Z'}}),{poolAddress:'late',targetPoolAddress:'late',targetVerified:true});
  assert.deepEqual(phase7VerifiedDecisionHealthPoolAddress({...base,latestDecisionAtByPool:{missing:'2026-08-20T11:59:59.999Z'}}),{poolAddress:'smoke',targetPoolAddress:'missing',targetVerified:false});
  assert.deepEqual(phase7VerifiedDecisionHealthPoolAddress({smokePoolAddress:'smoke',priorControlPayload:{decisionHealthPoolAddress:'smoke'}}),{poolAddress:'smoke',targetPoolAddress:'smoke',targetVerified:true});
});

test('controlled canary watch fails closed for open, pending, or reconciliating portfolios',()=>{
  for(const portfolioState of [
    {...portfolio,openPositions:1},
    {...portfolio,pendingExecutionCount:1},
    {...portfolio,pendingReservedLamports:1n},
    {...portfolio,unresolvedReconciliationDebt:1},
  ]){
    const result=resolveControlledCanaryWatch({env,now,portfolio:portfolioState,authorization:authorized});
    assert.equal(result.activate,false);
    assert.ok(result.reasonCodes.includes('P7_CONTROLLED_CANARY_PORTFOLIO_NOT_EMPTY'));
  }
});
test('explicit canary approval revocations are deterministic and auditable control facts',()=>{
 assert.deepEqual(controlledCanaryRevokedApprovalIds({LPFORGE_P7_CONTROLLED_CANARY_REVOKED_APPROVAL_IDS:' approval-b,approval-a,approval-b '}),['approval-a','approval-b']);
 assert.deepEqual(controlledCanaryRevokedApprovalIds({}),[]);
});
