import test from 'node:test';
import assert from 'node:assert/strict';
import {applyFeeEvidenceCalibration,calibrateCandidateReplayFee,FEE_EVIDENCE_CALIBRATION_VERSION} from '../.build/packages/fee-evidence-calibration/src/index.js';
import {rankCandidates} from '../.build/packages/candidate-ranking/src/index.js';

const simulation=(overrides={})=>({candidateId:'candidate-a',strategy:'BID_ASK',orientation:'SKEWED_Y',activeTimeRatio:.7,activeDurationMs:3_600_000,inactiveDurationMs:0,unobservedDurationMs:0,occupancyCoverageRatio:1,occupancyState:'COMPLETE',lowerExitCount:0,upperExitCount:0,feeValue:.00034434123892509413,inventoryChangeValue:-.0000876340654133178,grossValueChange:.0002567071735117763,totalCostValue:.00001,netValue:.0002467071735117763,feeToAdverseInventoryRatio:null,fidelity:'EVENT_PATH_ESTIMATE',valueUnit:'TOKEN_X',capitalValue:.03,startInventoryValue:.000217,normalizationScale:.1377232403969734,unitScaleValid:true,evidenceActionable:true,warnings:[],...overrides});
const candidate={id:'candidate-a',family:'WIDE',strategy:'BID_ASK',orientation:'SKEWED_Y',lowerBinId:1,upperBinId:17,centerBinId:9,widthBins:17,lowerOffsetBins:-8,upperOffsetBins:8,lowerDistancePct:-1,upperDistancePct:1,reasonCodes:[],capitalFraction:1,perBinWeights:[{binId:1,weight:1}]};
const survival={rangeId:'candidate-a',horizonMinutes:60,samples:10,survivalProbability:.9,expectedActiveTimeRatio:.8,lowerExitProbability:.04,upperExitProbability:.06,medianFirstPassageMinutes:null,revisitAfterExitProbability:.1,confidence:.9,fitThrough:'2026-08-29T00:00:00.000Z'};

test('raw replay remains immutable while calibrated fee is authoritative',()=>{
 const raw=simulation(),calibrated=applyFeeEvidenceCalibration(raw);
 assert.equal(calibrated.rawReplayFeeValue,raw.feeValue);
 assert.equal(calibrated.rawReplayNetValue,raw.netValue);
 assert.equal(calibrated.feeEvidenceCalibration.version,FEE_EVIDENCE_CALIBRATION_VERSION);
 assert.equal(calibrated.feeEvidenceCalibration.credibility,0);
 assert.equal(calibrated.feeValue,0);
 assert.equal(calibrated.netValue,raw.inventoryChangeValue-raw.totalCostValue);
});

test('ordinary-scale supported replay retains bounded nonzero credibility deterministically',()=>{
 const first=calibrateCandidateReplayFee({rawReplayFeeValue:.00012,normalizationScale:.0055});
 const second=calibrateCandidateReplayFee({rawReplayFeeValue:.00012,normalizationScale:.0055});
 assert.deepEqual(first,second);
 assert.equal(first.status,'CALIBRATED');
 assert.ok(first.credibility>0&&first.credibility<1);
 assert.ok(first.calibratedFeeValue>0&&first.calibratedFeeValue<first.rawReplayFeeValue);
});

test('missing calibration evidence fails closed and never substitutes credibility one',()=>{
 const calibrated=applyFeeEvidenceCalibration(simulation({normalizationScale:Number.NaN}));
 assert.equal(calibrated.evidenceActionable,false);
 assert.equal(calibrated.feeValue,0);
 assert.equal(calibrated.feeEvidenceCalibration.status,'EVIDENCE_INSUFFICIENT');
 assert.equal(calibrated.feeEvidenceCalibration.credibility,null);
 assert.ok(calibrated.warnings.includes('FEE_CALIBRATION_EVIDENCE_INSUFFICIENT'));
});

test('calibration does not create a fee-to-TVL hard gate or alter inventory and costs',()=>{
 const raw=simulation({normalizationScale:.0055}),calibrated=applyFeeEvidenceCalibration(raw);
 assert.equal(calibrated.inventoryChangeValue,raw.inventoryChangeValue);
 assert.equal(calibrated.totalCostValue,raw.totalCostValue);
 assert.equal(calibrated.netValue,calibrated.feeValue+raw.inventoryChangeValue-raw.totalCostValue);
 assert.ok(!calibrated.feeEvidenceCalibration.reasonCodes.some(code=>code.includes('FEE_TVL')));
});

test('normalization-amplified replay cannot remain a ranking winner at full raw credibility',()=>{
 const raw=simulation(),calibrated=applyFeeEvidenceCalibration(raw);
 const rankedRaw=rankCandidates({candidates:[candidate],simulations:[raw],survivalForecasts:{[candidate.id]:survival},qualificationPolicyId:'candidate-primary-risk-adjusted-v1'});
 const rankedCalibrated=rankCandidates({candidates:[candidate],simulations:[calibrated],survivalForecasts:{[candidate.id]:survival},qualificationPolicyId:'candidate-primary-risk-adjusted-v1'});
 assert.equal(rankedRaw.winner,candidate.id);
 assert.equal(rankedCalibrated.winner,'NO_TRADE');
});

test('Canary #1 and Canary #4 historical replay shapes calibrate without candidate-specific production rules',()=>{
 const canary1=applyFeeEvidenceCalibration(simulation({feeValue:.00012187589711249864,inventoryChangeValue:-.000021584520709941042,grossValueChange:.0001002913764025576,totalCostValue:.00001,netValue:.0000902913764025576,normalizationScale:.005561840671663344}));
 const canary4=applyFeeEvidenceCalibration(simulation());
 assert.ok(canary1.feeEvidenceCalibration.credibility>0);
 assert.ok(canary1.feeValue<canary1.rawReplayFeeValue);
 assert.equal(canary4.feeEvidenceCalibration.credibility,0);
 assert.ok(canary4.netValue<0);
});
