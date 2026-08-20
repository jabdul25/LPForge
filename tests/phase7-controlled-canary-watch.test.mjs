import test from 'node:test';
import assert from 'node:assert/strict';
import {resolveControlledCanaryWatch} from '../.build/packages/phase7-production-service/src/index.js';

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
  const result=resolveControlledCanaryWatch({env,now,portfolio,authorization:authorized});
  assert.equal(result.activate,true);
  assert.equal(result.approval?.action,'PROMOTE_PRODUCTION');
  assert.equal(result.approval?.approvalId,'canary-watch-entry-live');
  assert.equal(result.approval?.expiresAt,'2026-08-20T12:01:00.000Z');
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
