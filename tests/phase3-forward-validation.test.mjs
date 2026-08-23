import test from 'node:test';
import assert from 'node:assert/strict';
import { buildPhase3ForwardCalibration, freezePhase3ForwardDecision, matureFrozenPhase3ForwardOutcome, phase3ForwardDecisionStoreValue } from '../.build/packages/phase3-forward-validation/src/index.js';

const sha='a'.repeat(40),hash='b'.repeat(64),start='2026-08-23T00:00:00.000Z';
const at=(minute)=>new Date(Date.parse(start)+minute*60_000).toISOString();
const candidate={id:'frozen',family:'BASE',lowerBinId:10,upperBinId:10,centerBinId:10,widthBins:1,lowerOffsetBins:0,upperOffsetBins:0,lowerDistancePct:0,upperDistancePct:0,strategy:'SPOT',orientation:'BALANCED',capitalFraction:1,perBinWeights:[{binId:10,weight:1}],reasonCodes:[]};
const simulation={candidateId:'frozen',strategy:'SPOT',orientation:'BALANCED',activeTimeRatio:1,activeDurationMs:60_000,inactiveDurationMs:0,unobservedDurationMs:0,occupancyCoverageRatio:1,occupancyState:'COMPLETE',lowerExitCount:0,upperExitCount:0,feeValue:.01,inventoryChangeValue:0,grossValueChange:.01,totalCostValue:.001,netValue:.009,feeToAdverseInventoryRatio:null,fidelity:'EVENT_PATH_ESTIMATE',valueUnit:'TOKEN_X',capitalValue:.03,startInventoryValue:.03,normalizationScale:1,unitScaleValid:true,evidenceActionable:true,warnings:[]};
const recommendation={recommendationId:'rec-forward',phase:'P3',recommendationOnly:true,decisionAt:start,expiresAt:at(5),pool:'pool-forward',state:'WATCHING',noTrade:true,marketContextHash:'context',regime:{transitionRisk:.2},economics:{expectedFeeValue:.001,expectedInventoryPnl:-.0001,expectedExecutionCost:.00001,expectedRepositionCost:.00002,expectedTailRiskCharge:.00003,expectedNetLpValue:.00084,expectedActiveTimeRatio:.6,forecastUncertainty:.7,evidenceFidelity:'EVENT_PATH_ESTIMATE'},uncertaintyLineage:{evidenceUncertainty:.2,forecastUncertainty:.7,components:{evidence:.2,regimeAmbiguity:.3,outcomeDispersion:.4}},candidateCount:1,simulations:[simulation],ranking:{winner:'NO_TRADE',rankings:[{candidateId:'frozen',utility:.01}],reasonCodes:[]},forwardValidation:{version:'phase3-forward-decision-v1',horizonMinutes:30,capitalValue:.03,capitalLamports:'30000000',activeBinIdAtDecision:10,rawUnitValueX:.001,rawUnitValueY:.001,costs:{compositionFeeValue:'0',transactionFeeValue:'.00001',slippageValue:'0',rebalanceCostValue:'.00002',otherCostValue:'.00003'},selectedCandidateKind:'TOP_RANKED_COUNTERFACTUAL',selectedCandidate:candidate,selectedSimulation:simulation,selectedSurvival:{survivalProbability:.9},evidence:{replayAnchorAt:start,replayEvidenceWatermark:start,historicalFrameHash:'frame',historicalEventHash:'event'},wouldAugEraThesisSemanticsHaveCreatedThesis:true},reasonCodes:['SHADOW_NO_TRADE']};
const artifact={sourceSha:sha,buildId:hash,policyHash:'c'.repeat(64),migrationHead:'M0046_phase3_forward_outcome_result_hash.sql'};
const frame=(minute,activeBinId=10)=>({observedAt:at(minute),activeBinId,bins:[{binId:10,price:'1',amountX:'2000000',amountY:'2000000',liquiditySupply:'1000000'}]});
const frames=Array.from({length:31},(_,minute)=>frame(minute));
const events=[{signature:'fwd-event',eventIndex:0,pool:'pool-forward',startBinId:10,endBinId:10,mmFee:'1000',feesOnTokenX:true,stamp:{source:'FIXTURE',observedAt:at(1)},raw:{}}];

test('FWD-001/002 frozen no-trade and WATCHING decision preserves exact geometry, weights and artifact provenance',()=>{
 const frozen=freezePhase3ForwardDecision({recommendation,artifact});
 assert.equal(frozen.phase3Outcome,'WATCHING');assert.deepEqual(frozen.selectedCandidate.perBinWeights,candidate.perBinWeights);assert.equal(frozen.sourceSha,sha);assert.equal(frozen.wouldAugEraThesisSemanticsHaveCreatedThesis,true);
 const noTrade=freezePhase3ForwardDecision({recommendation:{...recommendation,recommendationId:'rec-no-trade',state:'REJECTED'},artifact});assert.equal(noTrade.phase3Outcome,'NO_TRADE');
 const db=phase3ForwardDecisionStoreValue(frozen);assert.deepEqual(db.candidateWeights,[{binId:10,weight:1}]);assert.equal(db.activeBinIdAtDecision,10);
});
test('FWD-003/004/005/006/007/008 captures ENTRY_READY immutably and remains deterministic on retry',()=>{
 const entry={...recommendation,recommendationId:'rec-entry',state:'ENTRY_READY',noTrade:false,thesis:{thesisId:'thesis',selectedCandidate:candidate}};
 const first=freezePhase3ForwardDecision({recommendation:entry,artifact}),second=freezePhase3ForwardDecision({recommendation:entry,artifact});
 assert.equal(first.phase3Outcome,'ENTRY_READY');assert.deepEqual(first,second);assert.equal(first.evidenceProvenance.latestObservationTimestampAllowedAtDecision,start);assert.equal(first.prediction.expectedNetEv,.00084);
});
test('MAT-001/002/003 maturates only within the frozen horizon with no lookahead',async()=>{
 const frozen=freezePhase3ForwardDecision({recommendation,artifact});
 const pending=await matureFrozenPhase3ForwardOutcome({decision:frozen,horizonMinutes:30,frames,events,now:at(29)});assert.equal(pending.state,'PENDING');
 const final=await matureFrozenPhase3ForwardOutcome({decision:frozen,horizonMinutes:30,frames:[...frames,frame(31,0)],events,now:at(31)});assert.equal(final.state,'FINAL');assert.equal(final.realized.coverageRatio,1);assert.equal(final.realized.rangeSurvived,true);
 const withoutAfter=await matureFrozenPhase3ForwardOutcome({decision:frozen,horizonMinutes:30,frames,events,now:at(31)});assert.equal(final.evidenceHash,withoutAfter.evidenceHash);assert.deepEqual(final.realized,withoutAfter.realized);
 const duplicate=await matureFrozenPhase3ForwardOutcome({decision:frozen,horizonMinutes:30,frames,events,now:at(31)});assert.deepEqual(duplicate,withoutAfter);
});
test('MAT-002/003 bound 60m and 120m to their own horizon',async()=>{
 const frozen=freezePhase3ForwardDecision({recommendation,artifact});
 const longFrames=Array.from({length:121},(_,minute)=>frame(minute));
 for(const horizonMinutes of [60,120]){const result=await matureFrozenPhase3ForwardOutcome({decision:frozen,horizonMinutes,frames:[...longFrames,frame(121,0)],events,now:at(121)});assert.equal(result.state,'FINAL');assert.equal(result.realized.coverageRatio,1);}
});
test('MAT-004/005 frozen geometry is not regenerated and incomplete future evidence fails closed',async()=>{
 const frozen=freezePhase3ForwardDecision({recommendation,artifact});
 const result=await matureFrozenPhase3ForwardOutcome({decision:frozen,horizonMinutes:30,frames:[frame(0),frame(30)],events,now:at(31)});
 assert.equal(result.state,'INSUFFICIENT_EVIDENCE');assert.ok(result.reasonCodes.includes('FORWARD_FUTURE_EVIDENCE_INSUFFICIENT'));
});
test('LOOK-004 does not treat decision-time event as future outcome evidence',async()=>{
 const frozen=freezePhase3ForwardDecision({recommendation,artifact});
 const atDecision={...events[0],signature:'at-decision',stamp:{...events[0].stamp,observedAt:start}};
 const result=await matureFrozenPhase3ForwardOutcome({decision:frozen,horizonMinutes:30,frames,events:[atDecision],now:at(31)});
 assert.equal(result.state,'FINAL');assert.equal(result.realized.realizedFeeValue,0);
});
test('CAL-001 reports deterministic confusion-matrix and uncertainty bucket math',()=>{
 const frozen=freezePhase3ForwardDecision({recommendation,artifact});
 const positive={recommendationId:frozen.recommendationId,horizonMinutes:30,outcomeModelVersion:'phase3-forward-outcome-v1',state:'FINAL',reasonCodes:[],realized:{realizedNetValue:.001}};
 const negative={...positive,recommendationId:'negative',realized:{realizedNetValue:-.001}};
 const report=buildPhase3ForwardCalibration([{decision:frozen,outcome:positive},{decision:{...frozen,recommendationId:'negative',prediction:{...frozen.prediction,expectedNetEv:-.001}},outcome:negative}]);
 assert.equal(report.summary.predictedPositiveRealizedPositive,1);assert.equal(report.summary.predictedNegativeRealizedNegative,1);assert.equal(report.uncertaintyBuckets['0.65–0.70'].count,2);
});
