import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import {assessClaimEconomics,assessFeeCompensationObservation,assessLiveManagementContext,assessOorLifecycle,decideLivePositionManagement,parseLivePositionManagementPolicy,parseOorLifecyclePolicy} from '../.build/packages/live-position-management/src/index.js';

const policy={...parseLivePositionManagementPolicy({schemaVersion:1,enabled:true,outOfRangeAction:'RESHAPE',claimAccruedFees:true,estimatedClaimCostLamports:'10',minimumClaimNetBenefitLamports:'10',missingPositionAction:'HOLD',replacementRange:'PRESERVE_WIDTH_CENTER_ACTIVE',planTtlMs:300000}),minimumClaimValueUsd:.10};
const oorPolicy=parseOorLifecyclePolicy({schemaVersion:2,policyVersion:'oor-lifecycle-v2',transientMinutes:10,sustainedMinutes:30,aboveMaxCloseAndReevaluateMinutes:30,belowMinCloseAndReevaluateMinutes:30,actionRequiredMinutes:60});
const owned={lpforgePositionId:'p',poolAddress:'POOL',positionAddress:'POS',ownerAddress:'OWNER',strategy:'CURVE',orientation:'BALANCED',lowerBinId:90,upperBinId:110,initialCapitalLamports:20_000_000n,thesisId:'thesis'};
const fact={address:'POS',pool:'POOL',owner:'OWNER',lowerBinId:90,upperBinId:110,totalXAmount:'10',totalYAmount:'20',feeX:'0',feeY:'0',stamp:{source:'METEORA_SDK',observedAt:'2026-08-13T00:00:00.000Z'},raw:{}};

const prior=(assessment,rangeState=assessment.state==='IN_RANGE'?'IN_RANGE':'OUT_OF_RANGE')=>({rangeState,...(assessment.direction?{direction:assessment.direction}:{}),...(assessment.firstOorDetectedAt?{firstOorDetectedAt:assessment.firstOorDetectedAt}:{}),...(assessment.continuousOorStartedAt?{continuousOorStartedAt:assessment.continuousOorStartedAt}:{}),...(assessment.belowOorSince?{belowOorSince:assessment.belowOorSince}:{}),latestObservedAt:assessment.latestObservedAt,...(assessment.lastReenteredAt?{lastReenteredAt:assessment.lastReenteredAt}:{}),excursionCount:assessment.excursionCount,totalOorDurationSeconds:assessment.totalOorDurationSeconds});
const oor=(observedAt,priorState,inventoryClassification='SAFE_OOR_SOL',rangeState='OUT_OF_RANGE',activeBinId=120,safety={})=>assessOorLifecycle({policy:oorPolicy,prior:priorState,observation:{observedAt,rangeState,activeBinId,lowerBinId:90,upperBinId:110,chainTruthFresh:true,reconciliationClean:true,noActiveManagementPlan:true,inventoryClassification,...safety}});
test('OOR above maximum closes and re-evaluates at the directional 30-minute cap',()=>{
  const first=oor('2026-08-13T00:00:00Z');assert.equal(first.state,'TRANSIENT_OOR');assert.equal(first.action,'HOLD');
  const sustained=oor('2026-08-13T00:20:00Z',prior(first));assert.equal(sustained.state,'SUSTAINED_OOR');assert.equal(sustained.action,'FRESH_EVALUATION');
  const stale=oor('2026-08-13T00:30:00Z',prior(sustained));assert.equal(stale.state,'OOR_STALE_CAPITAL');assert.equal(stale.action,'CLOSE_AND_REEVALUATE');assert.ok(stale.reasonCodes.includes('POSITION_OOR_ABOVE_MAX_DIRECTIONAL_CAP'));assert.equal(stale.continuousOorDurationSeconds,1800);
  assert.equal(decideLivePositionManagement({policy,owned,position:fact,activeBinId:120,oor:stale}).action,'CLOSE');
});
test('BELOW_MIN closes and re-evaluates exactly at its direction-specific 30-minute cap',()=>{
  const first=oor('2026-08-13T00:00:00Z',undefined,'SAFE_OOR_SOL','OUT_OF_RANGE',80);
  const before=oor('2026-08-13T00:29:59Z',prior(first),'SAFE_OOR_SOL','OUT_OF_RANGE',80);
  assert.equal(before.state,'SUSTAINED_OOR');assert.equal(before.action,'FRESH_EVALUATION');
  const stale=oor('2026-08-13T00:30:00Z',prior(before),'SAFE_OOR_SOL','OUT_OF_RANGE',80);
  assert.equal(stale.state,'OOR_STALE_CAPITAL');assert.equal(stale.action,'CLOSE_AND_REEVALUATE');
  assert.ok(stale.reasonCodes.includes('POSITION_OOR_BELOW_MIN_DIRECTIONAL_CAP'));
  assert.equal(stale.continuousBelowOorDurationSeconds,1800);
  assert.equal(decideLivePositionManagement({policy,owned,position:fact,activeBinId:80,oor:stale}).action,'CLOSE');
});
test('IN_RANGE resets the below timer',()=>{
  const first=oor('2026-08-13T00:00:00Z',undefined,'SAFE_OOR_SOL','OUT_OF_RANGE',80);
  const twentyBelow=oor('2026-08-13T00:20:00Z',prior(first),'SAFE_OOR_SOL','OUT_OF_RANGE',80);
  const reentered=oor('2026-08-13T00:20:01Z',prior(twentyBelow),'SAFE_OOR_SOL','IN_RANGE',100);assert.equal(reentered.state,'IN_RANGE');assert.equal(reentered.continuousBelowOorDurationSeconds,0);
  const secondBelow=oor('2026-08-13T00:20:02Z',prior(reentered),'SAFE_OOR_SOL','OUT_OF_RANGE',80);
  const fifteenBelow=oor('2026-08-13T00:35:02Z',prior(secondBelow),'SAFE_OOR_SOL','OUT_OF_RANGE',80);
  assert.notEqual(fifteenBelow.action,'CLOSE_AND_REEVALUATE');assert.equal(fifteenBelow.continuousBelowOorDurationSeconds,900);
});
test('ABOVE_MAX resets the below timer and never contributes elapsed time to it',()=>{
  const first=oor('2026-08-13T00:00:00Z',undefined,'SAFE_OOR_SOL','OUT_OF_RANGE',80);
  const twentyBelow=oor('2026-08-13T00:20:00Z',prior(first),'SAFE_OOR_SOL','OUT_OF_RANGE',80);
  const above=oor('2026-08-13T00:20:01Z',prior(twentyBelow),'SAFE_OOR_SOL','OUT_OF_RANGE',120);assert.equal(above.belowOorSince,undefined);
  const secondBelow=oor('2026-08-13T00:20:02Z',prior(above),'SAFE_OOR_SOL','OUT_OF_RANGE',80);
  const fifteenBelow=oor('2026-08-13T00:35:02Z',prior(secondBelow),'SAFE_OOR_SOL','OUT_OF_RANGE',80);
  assert.notEqual(fifteenBelow.action,'CLOSE_AND_REEVALUATE');assert.equal(fifteenBelow.continuousBelowOorDurationSeconds,900);
});
test('40 minutes ABOVE_MAX followed by first BELOW_MIN observation does not fire the below rule',()=>{
  const firstAbove=oor('2026-08-13T00:00:00Z');
  const staleAbove=oor('2026-08-13T00:40:00Z',prior(firstAbove));assert.equal(staleAbove.action,'CLOSE_AND_REEVALUATE');assert.ok(staleAbove.reasonCodes.includes('POSITION_OOR_ABOVE_MAX_DIRECTIONAL_CAP'));
  const firstBelow=oor('2026-08-13T00:40:01Z',prior(staleAbove),'SAFE_OOR_SOL','OUT_OF_RANGE',80);
  assert.notEqual(firstBelow.action,'CLOSE_AND_REEVALUATE');assert.equal(firstBelow.continuousBelowOorDurationSeconds,0);assert.equal(firstBelow.belowOorSince,'2026-08-13T00:40:01Z');
});
test('unavailable chain truth or active management plan never advances or dispatches the below close',()=>{
  const first=oor('2026-08-13T00:00:00Z',undefined,'SAFE_OOR_SOL','OUT_OF_RANGE',80);
  const unavailable=oor('2026-08-13T00:30:00Z',prior(first),'SAFE_OOR_SOL','OUT_OF_RANGE',80,{chainTruthFresh:false});assert.equal(unavailable.action,'HOLD_CHAIN_RECONCILIATION');assert.equal(unavailable.continuousBelowOorDurationSeconds,0);assert.equal(unavailable.belowOorSince,first.belowOorSince);
  const activePlan=oor('2026-08-13T00:30:00Z',prior(first),'SAFE_OOR_SOL','OUT_OF_RANGE',80,{noActiveManagementPlan:false});assert.equal(activePlan.action,'HOLD_CHAIN_RECONCILIATION');assert.ok(activePlan.reasonCodes.includes('POSITION_OOR_MANAGEMENT_PLAN_PENDING'));
});
test('routine claims require the configured USD threshold, while close bypasses it',()=>{assert.equal(decideLivePositionManagement({policy,owned,position:{...fact,feeY:'1'},activeBinId:100,claimExpectedValueLamports:100n,claimExpectedValueUsd:.0999}).action,'HOLD');assert.equal(decideLivePositionManagement({policy,owned,position:{...fact,feeY:'1'},activeBinId:100,claimExpectedValueLamports:20n,claimExpectedValueUsd:.10}).action,'CLAIM');assert.equal(decideLivePositionManagement({policy,owned,position:{...fact,feeY:'1'},activeBinId:100,claimExpectedValueLamports:20n,claimExpectedValueUsd:.15}).action,'CLAIM');const exit=decideLivePositionManagement({policy,owned,position:{...fact,feeY:'1'},activeBinId:100,claimExpectedValueLamports:1n,claimExpectedValueUsd:.02,exitDecision:{action:'CLOSE',reasonCodes:['EXIT_TEST']}});assert.equal(exit.action,'CLOSE');assert.equal(decideLivePositionManagement({policy,owned,activeBinId:100}).action,'HOLD');});
test('fee compensation is observational, restart-safe math and never emits an action',()=>{const r=assessFeeCompensationObservation({mfeInventoryValue:.03,currentInventoryValue:.029038831,mfeCumulativeGrossFees:.0001774,currentCumulativeGrossFees:.000661998});assert.equal(r.economicClassification,'PARTIALLY_FEE_COMPENSATED');assert.ok(Math.abs(r.feeCompensationRatio-.5042)<.0002);assert.ok(Math.abs(r.inventoryDeteriorationSinceMfe-.000961169)<1e-15);assert.ok(Math.abs(r.grossFeesSinceMfe-.000484598)<1e-15);assert.equal(assessFeeCompensationObservation({mfeInventoryValue:1,currentInventoryValue:1,mfeCumulativeGrossFees:0,currentCumulativeGrossFees:.1}).economicClassification,'NO_INVENTORY_DETERIORATION');});
test('partial entry bypasses ordinary claim, reshape, and replacement management into one protective close',()=>{
  const partial={...owned,partialEntry:true};
  const hold=decideLivePositionManagement({policy,owned:partial,position:{...fact,feeY:'1'},activeBinId:120,claimExpectedValueLamports:20n,currentForwardEv:.01});
  assert.equal(hold.action,'CLOSE');assert.deepEqual(hold.reasonCodes,['PARTIAL_ENTRY_PROTECTIVE_CLOSE_REQUIRED']);
  const emergency=decideLivePositionManagement({policy,owned:partial,position:fact,activeBinId:100,exitDecision:{action:'EMERGENCY_CLOSE',reasonCodes:['EXIT_EMERGENCY_STOP_LOSS']}});
  assert.equal(emergency.action,'EMERGENCY_CLOSE');assert.ok(emergency.reasonCodes.includes('PARTIAL_ENTRY_PROTECTIVE_CLOSE'));
});
test('claim economics evaluates total USD value, fails closed without valuation, and retains the existing net-benefit guard',()=>{const base={estimatedClaimCostLamports:10n,minimumClaimNetBenefitLamports:10n,minimumClaimValueUsd:.10};assert.equal(assessClaimEconomics(base).approved,false);assert.equal(assessClaimEconomics({...base,expectedClaimValueLamports:20n,expectedClaimValueUsd:.0999}).approved,false);assert.equal(assessClaimEconomics({...base,expectedClaimValueLamports:20n,expectedClaimValueUsd:.10}).approved,true);assert.equal(assessClaimEconomics({...base,expectedClaimValueLamports:20n,expectedClaimValueUsd:.15}).approved,true);assert.equal(assessClaimEconomics({...base,expectedClaimValueLamports:20n}).reasonCodes[0],'FEE_CLAIM_VALUE_UNAVAILABLE');});
test('normal management is bound to the position pool context',()=>{
  const poolA=assessLiveManagementContext({positionPoolAddress:'POOL_A',managementPoolAddress:'POOL_A',action:'CLAIM'});
  const poolBWhileEvaluatingA=assessLiveManagementContext({positionPoolAddress:'POOL_B',managementPoolAddress:'POOL_A',action:'RESHAPE'});
  const poolBAfterItsOwnEvaluation=assessLiveManagementContext({positionPoolAddress:'POOL_B',managementPoolAddress:'POOL_B',action:'RESHAPE'});
  assert.equal(poolA.planAllowed,true);
  assert.equal(poolBWhileEvaluatingA.planAllowed,false);
  assert.deepEqual(poolBWhileEvaluatingA.reasonCodes,['LIVE_MANAGEMENT_CONTEXT_POOL_MISMATCH']);
  assert.equal(poolBAfterItsOwnEvaluation.planAllowed,true);
});
test('only emergency protective management may proceed without a matching pool context',()=>{
  const emergency=assessLiveManagementContext({positionPoolAddress:'POOL_B',managementPoolAddress:'POOL_A',action:'EMERGENCY_CLOSE'});
  const ordinaryClose=assessLiveManagementContext({positionPoolAddress:'POOL_B',managementPoolAddress:'POOL_A',action:'CLOSE'});
  const hardStop=assessLiveManagementContext({positionPoolAddress:'POOL_B',managementPoolAddress:'POOL_A',action:'CLOSE',terminalProtectiveClose:true});
  assert.equal(emergency.planAllowed,true);
  assert.deepEqual(emergency.reasonCodes,['LIVE_MANAGEMENT_CONTEXT_EMERGENCY_INDEPENDENT']);
  assert.equal(ordinaryClose.planAllowed,false);
  assert.equal(hardStop.planAllowed,true);
  assert.deepEqual(hardStop.reasonCodes,['LIVE_MANAGEMENT_CONTEXT_HARD_STOP_INDEPENDENT']);
});
test('hard-stop close is explicitly wired as terminal protective management',()=>{
  const src=fs.readFileSync(new URL('../apps/operator/src/main.ts',import.meta.url),'utf8');
  assert.match(src,/terminalProtectiveClose:/);
  assert.match(src,/EXIT_HARD_POSITION_STOP_LOSS/);
});
test('lifecycle worker contains ordered replacement, chain-aware recovery, and token-X attribution',()=>{const src=fs.readFileSync(new URL('../packages/phase6-live-worker/src/index.ts',import.meta.url),'utf8');for(const token of ['REMOVE_OLD','AWAIT_REMOVE_RECONCILIATION','REFRESH_WALLET_TRUTH','BUILD_REPLACEMENT','getSignatureStatus','getPositionV2','P6_SEQUENCE_CHAIN_TRUTH_PENDING','recordPositionTokenXLot','sourceEvent:"FEE_CLAIM"','sourceEvent:"REDUCE_WITHDRAWAL"'])assert.match(src,new RegExp(token));assert.ok(src.indexOf('P6_MANAGEMENT_OLD_POSITION_STILL_EXISTS')<src.indexOf('BUILD_REPLACEMENT'));});
test("continuation close wiring is geometry-bound and cannot use generic pool EV",()=>{const src=fs.readFileSync(new URL("../apps/operator/src/main.ts",import.meta.url),"utf8");for(const token of ["loadPositionContinuationEconomics","candidate.strategy===position.strategy","candidate.lowerBinId===position.lowerBinId","estimateExpectedCloseCostLamports","forwardEvConfirmationCount","insertPositionManagementDecisionAudit"])assert.match(src,new RegExp(token));});
