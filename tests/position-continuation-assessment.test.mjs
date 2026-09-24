import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parseDeploymentPolicy } from '../.build/packages/deployment-policy/src/index.js';
import { assessPositionContinuation, parsePositionContinuationPriorState } from '../.build/packages/position-continuation-assessment/src/index.js';

const policy={enabled:true,firstAssessmentMinutes:60};
const at='2026-09-24T01:00:00.000Z';
const healthy=overrides=>assessPositionContinuation({policy,positionOpen:true,observedAt:at,enteredAt:'2026-09-24T00:00:00.000Z',liveControlEvidenceState:'AVAILABLE',liveControlReturnFraction:.01,rangeState:'IN_RANGE',inventoryClassification:'MIXED_INVENTORY',continuationEvLamports:1n,regime:'CONSOLIDATION',feeCompensationClassification:'FEE_COMPENSATED',...overrides});

test('position younger than its policy checkpoint has no PCA assessment',()=>{
  assert.equal(healthy({observedAt:'2026-09-24T00:59:59.000Z'}).status,'NONE');
});

test('checkpoint creates a completed observe-only assessment with a healthy approval',()=>{
  const result=healthy({});
  assert.equal(result.status,'COMPLETED');
  assert.equal(result.decision,'CONTINUATION_APPROVED');
  assert.deepEqual(result.reasonCodes,[]);
});

test('weak current economics or range evidence produces a degraded assessment without an action',()=>{
  const result=healthy({liveControlReturnFraction:-.02,rangeState:'OUT_OF_RANGE',inventoryClassification:'OOR_TOKEN_EXPOSURE',continuationEvLamports:0n,regime:'TREND_DOWN'});
  assert.equal(result.status,'COMPLETED');
  assert.equal(result.decision,'CONTINUATION_DEGRADED');
  for(const reason of ['LIVE_CONTROL_NEGATIVE','RANGE_OUT_OF_RANGE','INVENTORY_STRESS','CONTINUATION_EV_NON_POSITIVE','REGIME_DETERIORATING'])assert.ok(result.reasonCodes.includes(reason));
  assert.equal('action' in result,false);
});

test('a restart with durable pending state retains the original checkpoint and completes once',()=>{
  const prior=parsePositionContinuationPriorState({schemaVersion:1,status:'PENDING',checkpoint:'FIRST_FORECAST_HORIZON',startedAt:'2026-09-24T01:00:00.000Z'});
  const result=healthy({observedAt:'2026-09-24T01:05:00.000Z',prior});
  assert.equal(result.startedAt,'2026-09-24T01:00:00.000Z');
  assert.equal(result.decision,'CONTINUATION_APPROVED');
  const completed=parsePositionContinuationPriorState({schemaVersion:1,status:'COMPLETED',checkpoint:'FIRST_FORECAST_HORIZON',startedAt:'2026-09-24T01:00:00.000Z',completedAt:'2026-09-24T01:05:00.000Z',decision:'CONTINUATION_APPROVED',reasonCodes:[]});
  assert.equal(healthy({observedAt:'2026-09-24T02:00:00.000Z',prior:completed}).completedAt,'2026-09-24T01:05:00.000Z');
});

test('two positions are independent because each supplied durable record is position-local',()=>{
  const a=healthy({prior:parsePositionContinuationPriorState({schemaVersion:1,status:'COMPLETED',checkpoint:'FIRST_FORECAST_HORIZON',startedAt:at,completedAt:at,decision:'CONTINUATION_APPROVED',reasonCodes:[]})});
  const b=healthy({liveControlReturnFraction:-.03});
  assert.equal(a.decision,'CONTINUATION_APPROVED');
  assert.equal(b.decision,'CONTINUATION_DEGRADED');
});

test('policy is required and invalid continuation settings fail closed',()=>{
  const template=JSON.parse(readFileSync('release-policy-templates/live-execution-policy.json','utf8'));
  for(const positionContinuationAssessment of [undefined,{enabled:'true',firstAssessmentMinutes:60},{enabled:true,firstAssessmentMinutes:0},{enabled:true,firstAssessmentMinutes:60.5}])assert.throws(()=>parseDeploymentPolicy({...template,positionContinuationAssessment}),/POSITION_CONTINUATION_ASSESSMENT/);
  assert.deepEqual(parseDeploymentPolicy(template).positionContinuationAssessment,template.positionContinuationAssessment);
});

test('PCA source cannot create transaction plans or alter existing exit authorities',()=>{
  const assessor=readFileSync('packages/position-continuation-assessment/src/index.ts','utf8');
  const operator=readFileSync('apps/operator/src/main.ts','utf8');
  for(const forbidden of ['buildTransactionPlan','persistTransactionPlan','EXIT_STATE_A_DETERIORATION','EXIT_HARD_POSITION_STOP_LOSS'])assert.equal(assessor.includes(forbidden),false);
  for(const required of ['POSITION_CONTINUATION_ASSESSMENT_STARTED','POSITION_CONTINUATION_ASSESSMENT_COMPLETED','POSITION_CONTINUATION_DEGRADED','position_continuation_assessment','LPFORGE_POSITION_CONTINUATION_ASSESSMENT_POLICY_MISSING'])assert.match(operator,new RegExp(required));
});
