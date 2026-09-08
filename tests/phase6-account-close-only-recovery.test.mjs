import assert from 'node:assert/strict';
import test from 'node:test';
import {advanceConfirmedCloseChild,assessAccountCloseOnlyRecovery,accountCloseOnlySuccessorIdentity,canonicalTerminalActionEffect,isExactAccountCloseOnlySuccessor,selectCanonicalAccountCloseOnlySuccessor} from '../.build/packages/phase6-live-worker/src/index.js';

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

function plan({planId='parent',predecessorPlanId,position='position',pool='pool',owner='owner',generation=1}={}){
  const recovery=predecessorPlanId!==undefined;
  return{planId,intentId:`${planId}:intent`,state:'PLANNED',idempotencyKey:planId,action:'CLOSE',positionAddress:position,poolAddress:pool,ownerAddress:owner,thesisId:'thesis',observedAt:'2026-09-01T00:00:00.000Z',expiresAt:'2026-09-01T00:05:00.000Z',intentPayload:recovery?{accountCloseOnly:true,predecessorPlanId}:{},planPayload:{provenance:recovery?{terminalRecovery:true,predecessorPlanId}:{},autonomous_dispatch:recovery?{accountCloseOnly:true,terminalRootClosePlanId:predecessorPlanId,accountCloseOnlyRecoveryGeneration:generation}:{}},steps:recovery?[{transactionId:`${planId}:tx`,sequence:1,kind:'METEORA_CLOSE',state:'PLANNED',requiredSignerAddresses:[owner],metadata:{accountCloseOnly:true,predecessorPlanId,recoveryGeneration:generation}}]:[]};
}

test('account-close successor identity uses explicit provenance, never a matching plan prefix',()=>{
  const parent=plan(),successor=plan({planId:'parent:account-close-only:1',predecessorPlanId:'parent'});
  assert.equal(isExactAccountCloseOnlySuccessor({parent,successor}),true);
  const prefixOnly=plan({planId:'parent:account-close-only:2'});
  assert.equal(isExactAccountCloseOnlySuccessor({parent,successor:prefixOnly}),false);
  assert.equal(isExactAccountCloseOnlySuccessor({parent,successor:{...successor,poolAddress:'other'}}),false);
  assert.equal(isExactAccountCloseOnlySuccessor({parent,successor:{...successor,ownerAddress:'other'}}),false);
  assert.equal(isExactAccountCloseOnlySuccessor({parent,successor:{...successor,positionAddress:'other'}}),false);
});

test('terminal effect selects exact confirmed retry and ignores expired predecessor or unrelated lifecycle child',()=>{
  const transactions=[
    {planId:'parent',transactionId:'claim',signature:'expired',state:'FAILED_FINAL'},
    {planId:'parent',transactionId:'claim:retry-1',signature:'confirmed',state:'CONFIRMED'},
    {planId:'other',transactionId:'claim:retry-1',signature:'unrelated',state:'CONFIRMED'},
  ];
  assert.equal(canonicalTerminalActionEffect({transactions,planId:'parent',transactionIds:['claim:retry-1'],required:true}),'CONFIRMED_EFFECT');
  assert.equal(canonicalTerminalActionEffect({transactions,planId:'parent',transactionIds:['claim'],required:true}),'UNKNOWN_EFFECT');
  assert.equal(canonicalTerminalActionEffect({transactions,planId:'parent',transactionIds:['missing'],required:true}),'UNKNOWN_EFFECT');
});

test('recovered multi-child close advances one ordered child and never skips the remainder',()=>{
  const after0=advanceConfirmedCloseChild({kind:'REMOVE',transactionIds:['r0','r1','r2'],confirmedTransactionIds:[],pendingChildIndex:0});
  assert.deepEqual(after0,{valid:true,stage:'CLOSE_INVENTORY_SNAPSHOTTED',confirmedTransactionIds:['r0']});
  const skipped=advanceConfirmedCloseChild({kind:'REMOVE',transactionIds:['r0','r1','r2'],confirmedTransactionIds:[],pendingChildIndex:1});
  assert.equal(skipped.valid,false);assert.equal(skipped.reasonCode,'P6_CLOSE_REMOVE_RECOVERY_ORDER_INVALID');
  const final=advanceConfirmedCloseChild({kind:'CLAIM',transactionIds:['c0','c1'],confirmedTransactionIds:['c0'],pendingChildIndex:1});
  assert.deepEqual(final,{valid:true,stage:'CLOSE_CLAIMS_SETTLED',confirmedTransactionIds:['c0','c1']});
});
