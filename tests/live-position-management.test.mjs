import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import {assessClaimEconomics,assessFeeCompensationObservation,assessLiveManagementContext,assessOorLifecycle,decideLivePositionManagement,parseLivePositionManagementPolicy,parseOorLifecyclePolicy} from '../.build/packages/live-position-management/src/index.js';

const policy=parseLivePositionManagementPolicy({schemaVersion:1,enabled:true,outOfRangeAction:'RESHAPE',claimAccruedFees:true,estimatedClaimCostLamports:'10',minimumClaimNetBenefitLamports:'10',missingPositionAction:'HOLD',replacementRange:'PRESERVE_WIDTH_CENTER_ACTIVE',planTtlMs:300000});
const oorPolicy=parseOorLifecyclePolicy({schemaVersion:1,policyVersion:'oor-lifecycle-v1',transientMinutes:10,sustainedMinutes:30,actionRequiredMinutes:60});
const owned={lpforgePositionId:'p',poolAddress:'POOL',positionAddress:'POS',ownerAddress:'OWNER',strategy:'CURVE',orientation:'BALANCED',lowerBinId:90,upperBinId:110,initialCapitalLamports:20_000_000n,thesisId:'thesis'};
const fact={address:'POS',pool:'POOL',owner:'OWNER',lowerBinId:90,upperBinId:110,totalXAmount:'10',totalYAmount:'20',feeX:'0',feeY:'0',stamp:{source:'METEORA_SDK',observedAt:'2026-08-13T00:00:00.000Z'},raw:{}};

const oor=(observedAt,prior,inventoryClassification='SAFE_OOR_SOL',rangeState='OUT_OF_RANGE',activeBinId=120)=>assessOorLifecycle({policy:oorPolicy,prior,observation:{observedAt,rangeState,activeBinId,lowerBinId:90,upperBinId:110,chainTruthFresh:true,reconciliationClean:true,noActiveManagementPlan:true,inventoryClassification}});
test('OOR lifecycle is bounded: transient, sustained, action-required, then stale capital close',()=>{
  const first=oor('2026-08-13T00:00:00Z');assert.equal(first.state,'TRANSIENT_OOR');assert.equal(first.action,'HOLD');
  const sustained=oor('2026-08-13T00:20:00Z',{rangeState:'OUT_OF_RANGE',firstOorDetectedAt:first.firstOorDetectedAt,continuousOorStartedAt:first.continuousOorStartedAt,latestObservedAt:first.latestObservedAt,excursionCount:first.excursionCount,totalOorDurationSeconds:first.totalOorDurationSeconds});assert.equal(sustained.state,'SUSTAINED_OOR');assert.equal(sustained.action,'FRESH_EVALUATION');
  const required=oor('2026-08-13T00:45:00Z',{rangeState:'OUT_OF_RANGE',firstOorDetectedAt:first.firstOorDetectedAt,continuousOorStartedAt:first.continuousOorStartedAt,latestObservedAt:sustained.latestObservedAt,excursionCount:first.excursionCount,totalOorDurationSeconds:sustained.totalOorDurationSeconds});assert.equal(required.state,'OOR_ACTION_REQUIRED');assert.equal(required.action,'TEMPORARY_HOLD');
  const stale=oor('2026-08-13T01:01:00Z',{rangeState:'OUT_OF_RANGE',firstOorDetectedAt:first.firstOorDetectedAt,continuousOorStartedAt:first.continuousOorStartedAt,latestObservedAt:required.latestObservedAt,excursionCount:first.excursionCount,totalOorDurationSeconds:required.totalOorDurationSeconds});assert.equal(stale.state,'OOR_STALE_CAPITAL');assert.equal(stale.action,'CLOSE_AND_REEVALUATE');
  assert.equal(decideLivePositionManagement({policy,owned,position:fact,activeBinId:120,oor:stale}).action,'CLOSE');
});
test('re-entry resets continuous OOR time and a lower token exposure receives action at 30m',()=>{
  const first=oor('2026-08-13T00:00:00Z');
  const reentered=oor('2026-08-13T00:08:00Z',{rangeState:'OUT_OF_RANGE',firstOorDetectedAt:first.firstOorDetectedAt,continuousOorStartedAt:first.continuousOorStartedAt,latestObservedAt:first.latestObservedAt,excursionCount:first.excursionCount,totalOorDurationSeconds:first.totalOorDurationSeconds},'SAFE_OOR_SOL','IN_RANGE',100);assert.equal(reentered.state,'IN_RANGE');assert.equal(reentered.continuousOorDurationSeconds,0);
  const token=oor('2026-08-13T00:31:00Z',{rangeState:'OUT_OF_RANGE',continuousOorStartedAt:'2026-08-13T00:00:00Z',latestObservedAt:'2026-08-13T00:30:00Z',excursionCount:1,totalOorDurationSeconds:1800},'OOR_TOKEN_EXPOSURE');assert.equal(token.state,'OOR_ACTION_REQUIRED');assert.equal(token.action,'CLOSE');
});
test('stale or unreconciled chain truth never authorizes OOR close',()=>{
  const r=assessOorLifecycle({policy:oorPolicy,observation:{observedAt:'2026-08-13T01:01:00Z',rangeState:'OUT_OF_RANGE',activeBinId:120,lowerBinId:90,upperBinId:110,chainTruthFresh:false,reconciliationClean:true,noActiveManagementPlan:true,inventoryClassification:'SAFE_OOR_SOL'}});assert.equal(r.action,'HOLD_CHAIN_RECONCILIATION');
});
test('owned-position management claims only economically sufficient accrued fees and holds on unknown chain truth',()=>{assert.equal(decideLivePositionManagement({policy,owned,position:{...fact,feeY:'1'},activeBinId:100,claimExpectedValueLamports:20n}).action,'CLAIM');assert.equal(decideLivePositionManagement({policy,owned,position:{...fact,feeY:'1'},activeBinId:100,claimExpectedValueLamports:19n}).action,'HOLD');assert.equal(decideLivePositionManagement({policy,owned,activeBinId:100}).action,'HOLD');});
test('fee compensation is observational, restart-safe math and never emits an action',()=>{const r=assessFeeCompensationObservation({mfeInventoryValue:.03,currentInventoryValue:.029038831,mfeCumulativeGrossFees:.0001774,currentCumulativeGrossFees:.000661998});assert.equal(r.economicClassification,'PARTIALLY_FEE_COMPENSATED');assert.ok(Math.abs(r.feeCompensationRatio-.5042)<.0002);assert.ok(Math.abs(r.inventoryDeteriorationSinceMfe-.000961169)<1e-15);assert.ok(Math.abs(r.grossFeesSinceMfe-.000484598)<1e-15);assert.equal(assessFeeCompensationObservation({mfeInventoryValue:1,currentInventoryValue:1,mfeCumulativeGrossFees:0,currentCumulativeGrossFees:.1}).economicClassification,'NO_INVENTORY_DETERIORATION');});
test('partial entry bypasses ordinary claim, reshape, and replacement management into one protective close',()=>{
  const partial={...owned,partialEntry:true};
  const hold=decideLivePositionManagement({policy,owned:partial,position:{...fact,feeY:'1'},activeBinId:120,claimExpectedValueLamports:20n,currentForwardEv:.01});
  assert.equal(hold.action,'CLOSE');assert.deepEqual(hold.reasonCodes,['PARTIAL_ENTRY_PROTECTIVE_CLOSE_REQUIRED']);
  const emergency=decideLivePositionManagement({policy,owned:partial,position:fact,activeBinId:100,exitDecision:{action:'EMERGENCY_CLOSE',reasonCodes:['EXIT_EMERGENCY_STOP_LOSS']}});
  assert.equal(emergency.action,'EMERGENCY_CLOSE');assert.ok(emergency.reasonCodes.includes('PARTIAL_ENTRY_PROTECTIVE_CLOSE'));
});
test('claim economics defers dust and fails closed without a trustworthy SOL value',()=>{assert.equal(assessClaimEconomics({estimatedClaimCostLamports:10n,minimumClaimNetBenefitLamports:10n}).approved,false);assert.equal(assessClaimEconomics({expectedClaimValueLamports:19n,estimatedClaimCostLamports:10n,minimumClaimNetBenefitLamports:10n}).approved,false);assert.equal(assessClaimEconomics({expectedClaimValueLamports:20n,estimatedClaimCostLamports:10n,minimumClaimNetBenefitLamports:10n}).approved,true);});
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
  assert.equal(emergency.planAllowed,true);
  assert.deepEqual(emergency.reasonCodes,['LIVE_MANAGEMENT_CONTEXT_EMERGENCY_INDEPENDENT']);
  assert.equal(ordinaryClose.planAllowed,false);
});
test('lifecycle worker contains ordered replacement, chain-aware recovery, and token-X attribution',()=>{const src=fs.readFileSync(new URL('../packages/phase6-live-worker/src/index.ts',import.meta.url),'utf8');for(const token of ['REMOVE_OLD','AWAIT_REMOVE_RECONCILIATION','REFRESH_WALLET_TRUTH','BUILD_REPLACEMENT','getSignatureStatus','getPositionV2','P6_SEQUENCE_CHAIN_TRUTH_PENDING','recordPositionTokenXLot','sourceEvent:"FEE_CLAIM"','sourceEvent:"REDUCE_WITHDRAWAL"'])assert.match(src,new RegExp(token));assert.ok(src.indexOf('P6_MANAGEMENT_OLD_POSITION_STILL_EXISTS')<src.indexOf('BUILD_REPLACEMENT'));});
test("continuation close wiring is geometry-bound and cannot use generic pool EV",()=>{const src=fs.readFileSync(new URL("../apps/operator/src/main.ts",import.meta.url),"utf8");for(const token of ["loadPositionContinuationEconomics","candidate.strategy===position.strategy","candidate.lowerBinId===position.lowerBinId","estimateExpectedCloseCostLamports","forwardEvConfirmationCount","insertPositionManagementDecisionAudit"])assert.match(src,new RegExp(token));});
