import assert from 'node:assert/strict';
import test from 'node:test';
import {derivePositionAttributedTerminalUnwind} from '../.build/packages/phase6-live-worker/src/index.js';

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

test('terminal claim belonging to this close is carried by the close delta and never double counted',()=>{
  const result=derivePositionAttributedTerminalUnwind({positionAddress,tokenMint,closePlanId,newlyWithdrawnRaw:80n,walletRawAfterClose:85n,lots:[lot('historic',5),lot('terminal',7,{planId:closePlanId})]});
  assert.equal(result.ok,true);assert.equal(result.amountRaw,85n);assert.deepEqual(result.feeLotAllocations,[{lotId:'historic',rawAmount:5n}]);
});

test('ZCAT regression: historic routine fee inventory is included, not treated as unrelated wallet balance',()=>{
  const result=derivePositionAttributedTerminalUnwind({positionAddress,tokenMint,closePlanId,newlyWithdrawnRaw:84003872046n,walletRawAfterClose:89877949860n,lots:[lot('zcat-claims',5874077814)]});
  assert.equal(result.ok,true);assert.equal(result.amountRaw,89877949860n);assert.deepEqual(result.feeLotAllocations,[{lotId:'zcat-claims',rawAmount:5874077814n}]);
});
