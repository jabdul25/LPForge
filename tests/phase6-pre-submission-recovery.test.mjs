import test from 'node:test';
import assert from 'node:assert/strict';
import {recoverUnfinishedAutonomousPlans} from '../.build/packages/phase6-live-worker/src/index.js';

test('P6 recovery terminalizes an unsubmitted claimed plan and releases any reservation',async()=>{
  const calls=[];
  const store={
    async loadUnresolvedAutonomousPlans(){return[{planId:'plan-orphan',idempotencyKey:'idem-orphan',action:'CLAIM',poolAddress:'pool',ownerAddress:'owner',positionAddress:'position',expiresAt:'2030-01-01T00:00:00.000Z'}];},
    async getExecutionJournal(){return{journal_id:'journal-orphan',idempotency_key:'idem-orphan',plan_id:'plan-orphan',state:'PLAN_CREATED',version:1,updated_at:'2026-08-14T00:00:00.000Z',payload:{}};},
    async updateExecutionJournal(value){calls.push(['journal',value]);return true;},
    async completeAutonomousPlan(value){calls.push(['complete',value]);},
    async transitionAutonomousPlan(value){calls.push(['transition',value]);},
    async releaseExecutionCapital(...value){calls.push(['release',value]);},
  };
  const result=await recoverUnfinishedAutonomousPlans({store,currentBlockHeight:1,now:'2026-08-14T00:01:00.000Z'});
  assert.equal(result[0].action,'RETURN_EXISTING_PLAN');
  assert.deepEqual(result[0].reasonCodes,['P6_RECOVERY_PRE_SUBMISSION_ABORTED']);
  assert.equal(calls.find(([kind])=>kind==='journal')[1].state,'FAILED');
  assert.equal(calls.find(([kind])=>kind==='complete')[1].state,'FAILED');
  assert.deepEqual(calls.find(([kind])=>kind==='release')[1],['plan-orphan','2026-08-14T00:01:00.000Z',['P6_RECOVERY_PRE_SUBMISSION_ABORTED']]);
});

test('P6 recovery terminalizes a claimed plan that never reached durable journaling',async()=>{
  const calls=[];
  const store={
    async loadUnresolvedAutonomousPlans(){return[{planId:'plan-no-journal',idempotencyKey:'idem-no-journal',action:'OPEN',poolAddress:'pool',ownerAddress:'owner',expiresAt:'2030-01-01T00:00:00.000Z'}];},
    async getExecutionJournal(){return undefined;},
    async completeAutonomousPlan(value){calls.push(['complete',value]);},
    async transitionAutonomousPlan(value){calls.push(['transition',value]);},
    async releaseExecutionCapital(...value){calls.push(['release',value]);},
  };
  const result=await recoverUnfinishedAutonomousPlans({store,currentBlockHeight:1,now:'2026-08-14T00:01:00.000Z'});
  assert.deepEqual(result[0].reasonCodes,['P6_RECOVERY_JOURNAL_MISSING_PRE_SUBMISSION_ABORTED']);
  assert.equal(calls.find(([kind])=>kind==='complete')[1].state,'FAILED');
  assert.deepEqual(calls.find(([kind])=>kind==='release')[1],['plan-no-journal','2026-08-14T00:01:00.000Z',['P6_RECOVERY_JOURNAL_MISSING_PRE_SUBMISSION_ABORTED']]);
});
