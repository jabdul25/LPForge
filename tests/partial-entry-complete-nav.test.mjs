import assert from 'node:assert/strict';
import test from 'node:test';
import {assessLiveExit,derivePositionEconomics,parseLiveExitGovernorPolicy} from '../.build/packages/live-exit-governor/src/index.js';
import {assessOpenChunkConstruction} from '../.build/packages/phase6-live-worker/src/index.js';

const sol='So11111111111111111111111111111111111111112';
const policy=parseLiveExitGovernorPolicy({schemaVersion:1,enabled:true,hardStopLossFraction:.12,emergencyStopLossFraction:.20,takeProfitFraction:0,profitProtection:{enabled:true,triggerFraction:.08,maxGivebackFraction:.05,minRetainedProfitFraction:.02},closeOnThesisInvalidated:true,closeOnNonPositiveForwardEv:true,reduceOnRiskBlock:true,reduceFraction:.5,maxHoldMinutes:0,maxHoldRequiresNonPositiveForwardEv:true,toxicityCloseThreshold:.8,toxicityEmergencyThreshold:.95});
const pool={token_x:{address:'POOL',decimals:6,price:1},token_y:{address:sol,decimals:9,price:100}};
const economics=(walletRaw,actual=30_000_000n)=>derivePositionEconomics({
  position:{totalXAmount:'1000000',totalYAmount:'10000000',feeX:'0',feeY:'0',claimedFeeX:'0',claimedFeeY:'0'},
  pool,initialCapitalLamports:30_000_000n,actualContributedLamports:actual,observedAt:'2026-08-29T04:53:16.672Z',
  attributedWalletInventory:walletRaw===undefined?[]:[{tokenMint:'POOL',tokenAmountRaw:String(walletRaw)}],
});

test('partial multi-chunk construction never becomes a fully constructed OPEN',()=>{
  const planned=[{transactionId:'chunk-1',sequence:1,kind:'METEORA_OPEN'},{transactionId:'chunk-2',sequence:2,kind:'METEORA_OPEN_CHUNK'}];
  const partial=assessOpenChunkConstruction({planned,dispositions:[{transactionId:'chunk-1',disposition:'CONFIRMED'},{transactionId:'chunk-2',disposition:'PROVEN_NOT_LANDED'}]});
  assert.equal(partial.fullyConstructed,false);assert.equal(partial.partial,true);assert.ok(partial.reasonCodes.includes('P6_OPEN_PARTIAL_CONSTRUCTION'));
  const complete=assessOpenChunkConstruction({planned,dispositions:[{transactionId:'chunk-1',disposition:'CONFIRMED'},{transactionId:'chunk-2',disposition:'CONFIRMED'}]});
  assert.equal(complete.fullyConstructed,true);assert.equal(complete.partial,false);
});

test('complete managed NAV includes attributed wallet inventory and prevents the incident-shaped false emergency stop',()=>{
  const lpOnly=economics(undefined),complete=economics(1_000_000);
  assert.equal(lpOnly.evidenceState,'AVAILABLE');assert.equal(complete.evidenceState,'AVAILABLE');
  assert.ok((lpOnly.netReturnFraction??0)<-.20,'PositionV2-only mark reproduces false emergency premise');
  assert.ok((complete.netReturnFraction??0)>-.12,'attributed wallet residual changes the authoritative managed NAV');
  assert.equal(assessLiveExit({policy,economics:complete}).action,'HOLD');
  assert.ok(complete.reasonCodes.includes('EXIT_VALUATION_COMPLETE_MANAGED_NAV'));
  assert.equal(complete.walletInventoryValueUsd,1);
});

test('complete managed NAV still triggers the unchanged emergency stop on a real complete loss',()=>{
  const loss=derivePositionEconomics({position:{totalXAmount:'0',totalYAmount:'10000000',feeX:'0',feeY:'0',claimedFeeX:'0',claimedFeeY:'0'},pool,initialCapitalLamports:30_000_000n,actualContributedLamports:30_000_000n,observedAt:'2026-08-29T04:53:16.672Z',attributedWalletInventory:[{tokenMint:'POOL',tokenAmountRaw:'100000'}]});
  assert.equal(loss.evidenceState,'AVAILABLE');assert.ok((loss.netReturnFraction??0)<=-.20);
  const decision=assessLiveExit({policy,economics:loss,completeNavFresh:true});assert.equal(decision.action,'EMERGENCY_CLOSE');assert.ok(decision.reasonCodes.includes('EXIT_EMERGENCY_STOP_LOSS'));
});

test('the immutable canary exit fixture is profitable only when the material residual and actual asset baseline are both present',()=>{
  const tokenPrice=.000513935671534359,solPrice=103.84570846028;
  const incidentPool={token_x:{address:'POOL',decimals:6,price:tokenPrice},token_y:{address:sol,decimals:9,price:solPrice}};
  const position={totalXAmount:'4274138735',totalYAmount:'0',feeX:'0',feeY:'0',claimedFeeX:'0',claimedFeeY:'0'};
  const full=derivePositionEconomics({position,pool:incidentPool,initialCapitalLamports:30_000_000n,actualContributedLamports:33_918_444n,observedAt:'2026-08-29T04:53:16.672Z',attributedWalletInventory:[{tokenMint:'POOL',tokenAmountRaw:'3023417042'}]});
  const historicalMistake=derivePositionEconomics({position,pool:incidentPool,initialCapitalLamports:30_000_000n,observedAt:'2026-08-29T04:53:16.672Z'});
  assert.equal(full.evidenceState,'AVAILABLE');assert.equal(historicalMistake.evidenceState,'AVAILABLE');
  assert.ok(Math.abs((full.netReturnFraction??0)-.06478448)<.000001,'complete NAV reproduces the +6.4784% exit-cycle result');
  assert.ok(Math.abs((historicalMistake.netReturnFraction??0)+.294905)<.00001,'PositionV2-only requested-capital comparison reproduces the false -29.4905% premise');
  assert.equal(assessLiveExit({policy,economics:full}).action,'HOLD');
  assert.equal(assessLiveExit({policy,economics:historicalMistake,completeNavFresh:true}).action,'EMERGENCY_CLOSE');
});

test('the first-observation regression remains above the unchanged emergency threshold under complete NAV',()=>{
  const first=derivePositionEconomics({position:{totalXAmount:'2006711',totalYAmount:'0',feeX:'0',feeY:'0',claimedFeeX:'0',claimedFeeY:'0'},pool:{token_x:{address:'POOL',decimals:6,price:1},token_y:{address:sol,decimals:9,price:100}},initialCapitalLamports:30_000_000n,actualContributedLamports:33_918_444n,observedAt:'2026-08-29T00:11:15.000Z',attributedWalletInventory:[{tokenMint:'POOL',tokenAmountRaw:'1000000'}]});
  assert.equal(first.evidenceState,'AVAILABLE');assert.ok(Math.abs((first.netReturnFraction??0)+.113547)<.00001);
  assert.notEqual(assessLiveExit({policy,economics:first}).action,'EMERGENCY_CLOSE');
});
