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
