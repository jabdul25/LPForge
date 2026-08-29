import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import {
  EXECUTION_TERMINAL_PLAN_STATES,
  executionPlanCountsAsPendingForPortfolio,
} from '../.build/packages/db/src/index.js';
import {resolveControlledCanaryWatch} from '../.build/packages/phase7-production-service/src/index.js';

const now='2026-08-29T12:00:00.000Z';
const env={
  LPFORGE_P7_MODE:'OBSERVE_ONLY',
  LPFORGE_P7_CONTROLLED_CANARY_WATCH_ENABLED:'true',
  LPFORGE_P7_CONTROLLED_CANARY_APPROVED_BY:'controlled-test-operator',
  LPFORGE_P7_CONTROLLED_CANARY_MAX_POSITIONS:'1',
  LPFORGE_P7_CONTROLLED_CANARY_MAX_LP_CAPITAL_LAMPORTS:'30000000',
};
const authorization={
  entryEvaluationId:'entry-live',
  thesisId:'thesis-live',
  poolAddress:'pool-live',
  observedAt:now,
  expiresAt:'2026-08-29T12:04:00.000Z',
  confidence:.8,
  reasonCodes:['ENTRY_TIMING_APPROVED'],
  payload:{},
};
const cleanPortfolio={
  openPositions:0,
  pendingExecutionCount:0,
  pendingReservedLamports:0n,
  unresolvedReconciliationDebt:0,
};

test('terminal historical execution cannot resurrect pending portfolio work',()=>{
  assert.ok(EXECUTION_TERMINAL_PLAN_STATES.includes('RECONCILED'));
  assert.ok(EXECUTION_TERMINAL_PLAN_STATES.includes('COMPLETED'));
  // Historical SENT evidence cannot override a terminal plan lifecycle.
  assert.equal(executionPlanCountsAsPendingForPortfolio('RECONCILED'),false);
  assert.equal(executionPlanCountsAsPendingForPortfolio('COMPLETED'),false);
});

test('genuinely nonterminal execution remains safety-blocking',()=>{
  for(const state of ['PLANNED','CLAIMED','SIGNING','SIGNED','SUBMITTED','UNKNOWN_SUBMISSION','RECONCILIATION_REQUIRED']){
    assert.equal(executionPlanCountsAsPendingForPortfolio(state),true,state);
  }
});

test('portfolio query uses terminal plan state as the sole lifecycle authority',()=>{
  const src=fs.readFileSync('packages/db/src/index.ts','utf8');
  const at=src.indexOf('async loadPhase7PortfolioFacts(');
  const end=src.indexOf('async loadPhase7PortfolioRiskState(',at);
  const fn=src.slice(at,end);
  assert.match(fn,/p\.state <> ALL\(\$2::text\[\]\)/);
  assert.doesNotMatch(fn,/submission_attempts a/);
  assert.match(fn,/EXECUTION_TERMINAL_PLAN_STATES/);
});

test('a clean portfolio with fresh Phase-4 approval activates the controlled canary',()=>{
  const result=resolveControlledCanaryWatch({
    env,
    now,
    portfolio:cleanPortfolio,
    authorization,
    decisionObservedAt:'2026-08-29T11:59:30.000Z',
  });
  assert.equal(result.activate,true);
  assert.ok(!result.reasonCodes.includes('P7_CONTROLLED_CANARY_PORTFOLIO_NOT_EMPTY'));
});

test('unknown submission still blocks a controlled canary OPEN',()=>{
  const result=resolveControlledCanaryWatch({
    env,
    now,
    portfolio:{...cleanPortfolio,pendingExecutionCount:1},
    authorization,
    decisionObservedAt:'2026-08-29T11:59:30.000Z',
  });
  assert.equal(result.activate,false);
  assert.ok(result.reasonCodes.includes('P7_CONTROLLED_CANARY_PORTFOLIO_NOT_EMPTY'));
});
