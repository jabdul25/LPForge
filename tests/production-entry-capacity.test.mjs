import assert from 'node:assert/strict';
import test from 'node:test';
import {assessProductionOpenPlanCapacity} from '../.build/packages/production-entry-capacity/src/index.js';

const SOL=1_000_000_000n;
const base={walletLamports:50_000_000n,reserveLamports:10_000_000n,minInitialPositionLamports:20_000_000n,maxPortfolioLamports:100_000_000n,maxOpenPositions:2,openPositions:0,deployedLamports:0n,pendingReservedLamports:0n};

test('production suppresses new plans when every open-position slot is occupied',()=>{
  const result=assessProductionOpenPlanCapacity({...base,openPositions:2});
  assert.equal(result.approved,false);
  assert.deepEqual(result.reasonCodes,['P7_PLAN_OPEN_POSITION_LIMIT']);
});

test('a stricter one-slot admission policy suppresses a second open even if a broader policy permits two',()=>{
  const result=assessProductionOpenPlanCapacity({...base,maxOpenPositions:1,openPositions:1});
  assert.equal(result.approved,false);
  assert.deepEqual(result.reasonCodes,['P7_PLAN_OPEN_POSITION_LIMIT']);
});

test('production suppresses new plans when wallet funds cannot cover reserve plus minimum position',()=>{
  const result=assessProductionOpenPlanCapacity({...base,walletLamports:29_999_999n});
  assert.equal(result.approved,false);
  assert.deepEqual(result.reasonCodes,['P7_PLAN_WALLET_RESERVE_INSUFFICIENT']);
});

test('production suppresses new plans when deployed and reserved capital exhaust portfolio capacity',()=>{
  const result=assessProductionOpenPlanCapacity({...base,deployedLamports:50_000_000n,pendingReservedLamports:31_000_000n,maxPortfolioLamports:100_000_000n});
  assert.equal(result.approved,false);
  assert.deepEqual(result.reasonCodes,['P7_PLAN_PORTFOLIO_CAPACITY_INSUFFICIENT']);
});

test('production permits plan preparation only when a slot, wallet reserve, and portfolio capacity all remain',()=>{
  const result=assessProductionOpenPlanCapacity(base);
  assert.equal(result.approved,true);
  assert.equal(result.availableWalletLamports,40_000_000n);
});
test('one OPEN position leaves a second policy-authorized slot and max=3 remains generic',()=>{
  const second=assessProductionOpenPlanCapacity({...base,walletLamports:154_200_000n,reserveLamports:10_000_000n,minInitialPositionLamports:30_000_000n,maxOpenPositions:2,openPositions:1,deployedLamports:30_000_000n});
  assert.equal(second.approved,true);
  const third=assessProductionOpenPlanCapacity({...base,maxOpenPositions:3,openPositions:2});
  assert.equal(third.approved,true);
});
test('the intentional same-pool owner guard is separate from global position capacity',()=>{
  const poolA=assessProductionOpenPlanCapacity({...base,maxOpenPositions:2,openPositions:1,livePositionExistsForPoolAndOwner:true});
  assert.equal(poolA.approved,false);
  assert.deepEqual(poolA.reasonCodes,['P7_PLAN_LIVE_POSITION_ALREADY_EXISTS_FOR_POOL']);
  const poolB=assessProductionOpenPlanCapacity({...base,maxOpenPositions:2,openPositions:1,livePositionExistsForPoolAndOwner:false});
  assert.equal(poolB.approved,true,'Pool A must not consume Pool B\'s slot');
  const third=assessProductionOpenPlanCapacity({...base,maxOpenPositions:2,openPositions:2,livePositionExistsForPoolAndOwner:false});
  assert.deepEqual(third.reasonCodes,['P7_PLAN_OPEN_POSITION_LIMIT']);
});
test('invalid position or capital policy inputs fail closed rather than falling back',()=>{
  assert.deepEqual(assessProductionOpenPlanCapacity({...base,maxOpenPositions:Number.NaN}).reasonCodes,['P7_PLAN_POSITION_LIMIT_INVALID']);
  assert.deepEqual(assessProductionOpenPlanCapacity({...base,maxOpenPositions:0}).reasonCodes,['P7_PLAN_POSITION_LIMIT_INVALID']);
  assert.deepEqual(assessProductionOpenPlanCapacity({...base,minInitialPositionLamports:0n}).reasonCodes,['P7_PLAN_CAPITAL_POLICY_INVALID']);
});
