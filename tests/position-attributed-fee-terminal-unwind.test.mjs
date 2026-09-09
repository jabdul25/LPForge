import assert from 'node:assert/strict';
import test from 'node:test';
import {derivePositionAttributedTerminalUnwind,parseDurableCloseLotAllocations} from '../.build/packages/phase6-live-worker/src/index.js';

const positionAddress='position-zcat',tokenMint='zcat',closePlanId='close-plan';
const lot=(lotId,rawAmount,overrides={})=>({lotId,positionAddress,planId:'claim-'+lotId,tokenMint,sourceEvent:'FEE_CLAIM',remainingRawAmount:BigInt(rawAmount),status:'OPEN',acquiredAt:`2026-09-05T00:00:0${lotId}Z`,...overrides});

test('terminal unwind combines newly withdrawn inventory with exact prior fee lots only',()=>{
  const result=derivePositionAttributedTerminalUnwind({positionAddress,tokenMint,closePlanId,newlyWithdrawnRaw:80n,walletRawAfterClose:185n,lots:[lot('1',2),lot('2',3),lot('manual',100,{positionAddress:'another-position'})]});
  assert.equal(result.ok,true);
  assert.equal(result.amountRaw,85n);
  assert.deepEqual(result.feeLotAllocations,[{lotId:'1',rawAmount:2n},{lotId:'2',rawAmount:3n}]);
});

test('unrelated wallet inventory is never inferred as position inventory',()=>{
  const result=derivePositionAttributedTerminalUnwind({positionAddress,tokenMint,closePlanId,newlyWithdrawnRaw:80n,walletRawAfterClose:185n,lots:[lot('fee',5),lot('other',100,{positionAddress:'other'})]});
  assert.equal(result.ok,true);assert.equal(result.amountRaw,85n);
});

test('wallet shortfall against receipt-backed position inventory fails closed',()=>{
  const result=derivePositionAttributedTerminalUnwind({positionAddress,tokenMint,closePlanId,newlyWithdrawnRaw:80n,walletRawAfterClose:84n,lots:[lot('fee',5)]});
  assert.deepEqual(result,{ok:false,reasonCodes:['P6_CLOSE_POSITION_ATTRIBUTED_FEE_LOTS_WALLET_SHORTFALL']});
});

test('terminal claim belonging to this close is separately receipt-attributed after the remove snapshot',()=>{
  const result=derivePositionAttributedTerminalUnwind({positionAddress,tokenMint,closePlanId,newlyWithdrawnRaw:80n,walletRawAfterClose:92n,lots:[lot('historic',5),lot('terminal',7,{planId:closePlanId})]});
  assert.equal(result.ok,true);assert.equal(result.amountRaw,92n);assert.deepEqual(result.feeLotAllocations,[{lotId:'historic',rawAmount:5n},{lotId:'terminal',rawAmount:7n}]);
});

test('ZCAT regression: historic routine fee inventory is included, not treated as unrelated wallet balance',()=>{
  const result=derivePositionAttributedTerminalUnwind({positionAddress,tokenMint,closePlanId,newlyWithdrawnRaw:84003872046n,walletRawAfterClose:89877949860n,lots:[lot('zcat-claims',5874077814)]});
  assert.equal(result.ok,true);assert.equal(result.amountRaw,89877949860n);assert.deepEqual(result.feeLotAllocations,[{lotId:'zcat-claims',rawAmount:5874077814n}]);
});

test('entry funding residual is receipt-bound position inventory and is unwound at terminal close',()=>{
  const result=derivePositionAttributedTerminalUnwind({positionAddress,tokenMint,closePlanId,newlyWithdrawnRaw:0n,walletRawAfterClose:3975128n,lots:[lot('entry-residual',3975128,{sourceEvent:'OPEN_RESIDUAL',planId:'entry-plan'})]});
  assert.equal(result.ok,true);assert.equal(result.amountRaw,3975128n);
  assert.deepEqual(result.openResidualLotAllocations,[{lotId:'entry-residual',rawAmount:3975128n}]);
  assert.deepEqual(result.lotAllocations,[{lotId:'entry-residual',rawAmount:3975128n}]);
});

test('entry residual wallet shortfall fails closed and never infers unrelated inventory',()=>{
  const result=derivePositionAttributedTerminalUnwind({positionAddress,tokenMint,closePlanId,newlyWithdrawnRaw:0n,walletRawAfterClose:3975127n,lots:[lot('entry-residual',3975128,{sourceEvent:'OPEN_RESIDUAL',planId:'entry-plan'})]});
  assert.deepEqual(result,{ok:false,reasonCodes:['P6_CLOSE_POSITION_ATTRIBUTED_FEE_LOTS_WALLET_SHORTFALL']});
});

test('durable close lot allocations preserve exact receipt-bound lots across restart',()=>{
  assert.deepEqual(parseDurableCloseLotAllocations([{lotId:'claim-x:lot',rawAmount:'6494363'}]),{ok:true,allocations:[{lotId:'claim-x:lot',rawAmount:6494363n}]});
  assert.deepEqual(parseDurableCloseLotAllocations([{lotId:'claim-x:lot',rawAmount:'0'}]),{ok:false});
  assert.deepEqual(parseDurableCloseLotAllocations([{lotId:'claim-x:lot',rawAmount:'7'},{lotId:'claim-x:lot',rawAmount:'1'}]),{ok:false});
});
