import assert from 'node:assert/strict';
import test from 'node:test';
import {assessAccountCloseOnlyRecovery,accountCloseOnlySuccessorIdentity,selectCanonicalAccountCloseOnlySuccessor} from '../.build/packages/phase6-live-worker/src/index.js';

const ready={priorAccountClose:'EXPIRED_NO_EFFECT',remove:'CONFIRMED_EFFECT',claim:'NOT_REQUIRED',primaryUnwind:'CONFIRMED_EFFECT',residualUnwind:'CONFIRMED_EFFECT',positionExists:true,totalXAmount:0n,totalYAmount:0n,feeX:0n,feeY:0n,rewardOne:0n,rewardTwo:0n,unresolvedInventoryLots:0};

test('expired empty account close is eligible for a distinct account-close-only successor',()=>{
  assert.deepEqual(assessAccountCloseOnlyRecovery(ready),{eligible:true,reasonCodes:[]});
  assert.deepEqual(accountCloseOnlySuccessorIdentity({planId:'plan-close',generation:1}),{planId:'plan-close:account-close-only:1',intentId:'plan-close:intent:account-close-only:1',transactionId:'plan-close:tx:account-close-only:1',idempotencyKey:'plan-close:account-close-only:1'});
});

test('confirmed economic children and not-required claim are never replayed by eligibility',()=>{
  for(const [field,value] of [['remove','EXPIRED_NO_EFFECT'],['primaryUnwind','EXPIRED_NO_EFFECT'],['residualUnwind','UNKNOWN_EFFECT'],['claim','UNKNOWN_EFFECT']]){
    const result=assessAccountCloseOnlyRecovery({...ready,[field]:value});
    assert.equal(result.eligible,false);
  }
});

test('account close only fails closed on residual chain economics or inventory',()=>{
  for(const input of [{...ready,totalXAmount:1n},{...ready,feeX:1n},{...ready,rewardOne:1n},{...ready,unresolvedInventoryLots:1},{...ready,positionExists:'UNKNOWN'}])assert.equal(assessAccountCloseOnlyRecovery(input).eligible,false);
});

test('the recovery identity is stable across repeated observations and cannot fan out into close attempts',()=>{
  const once=accountCloseOnlySuccessorIdentity({planId:'plan-close',generation:1});
  const again=accountCloseOnlySuccessorIdentity({planId:'plan-close',generation:1});
  assert.equal(once.planId,again.planId);
  assert.equal(once.idempotencyKey,again.idempotencyKey);
});

test('a duplicate recovery trigger retains only the deterministic earliest successor',()=>{
  const selected=selectCanonicalAccountCloseOnlySuccessor([
    {planId:'plan-close:account-close-only:2',createdAt:'2026-09-01T00:00:02.000Z'},
    {planId:'plan-close:account-close-only:1',createdAt:'2026-09-01T00:00:01.000Z'},
  ]);
  assert.equal(selected.canonical.planId,'plan-close:account-close-only:1');
  assert.deepEqual(selected.duplicates.map(row=>row.planId),['plan-close:account-close-only:2']);
});
