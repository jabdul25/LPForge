import test from 'node:test';
import assert from 'node:assert/strict';
import {
  CANDIDATE_PRIMARY_RISK_ADJUSTED_QUALIFICATION_POLICY_V1,
  GLOBAL_PRIMARY_QUALIFICATION_POLICY_V1,
  deriveOpportunityProgress,
  deriveQualificationEconomics,
} from '../.build/packages/opportunity/src/index.js';
import { rankCandidates } from '../.build/packages/candidate-ranking/src/index.js';
import { generateLpThesis } from '../.build/packages/thesis/src/index.js';
import { freezePhase3ForwardDecision } from '../.build/packages/phase3-forward-validation/src/index.js';

const candidate=(id='candidate',width=61)=>({id,family:'WIDE',lowerBinId:100,upperBinId:100+width-1,centerBinId:100+Math.floor(width/2),widthBins:width,lowerOffsetBins:-Math.floor(width/2),upperOffsetBins:Math.floor(width/2),lowerDistancePct:-1,upperDistancePct:1,reasonCodes:[],strategy:'CURVE',orientation:'SKEWED_Y',capitalFraction:1,perBinWeights:[{binId:100,weight:1}]});
const simulation=(id='candidate',net=.0001)=>({candidateId:id,strategy:'CURVE',orientation:'SKEWED_Y',activeTimeRatio:.8,lowerExitCount:0,upperExitCount:0,feeValue:.00015,inventoryChangeValue:-.00002,grossValueChange:.00011,totalCostValue:.00001,netValue:net,feeToAdverseInventoryRatio:null,fidelity:'EVENT_PATH_ESTIMATE',valueUnit:'TOKEN_X',capitalValue:.03,startInventoryValue:.03,normalizationScale:1,unitScaleValid:true,evidenceActionable:true,warnings:[]});
const survival=id=>({rangeId:id,horizonMinutes:60,samples:10,survivalProbability:.9,expectedActiveTimeRatio:.8,lowerExitProbability:.04,upperExitProbability:.06,medianFirstPassageMinutes:null,revisitAfterExitProbability:.1,confidence:.9,fitThrough:'2026-08-24T00:00:00.000Z'});
const pool={pool:'pool',eligibility:'ELIGIBLE',dataQuality:'GOOD',blockers:[],toxicityProbability:.1};
const economics=(net=-.00004,uncertainty=.2)=>({expectedNetLpValue:net,economicallyPositive:net>0,forecastUncertainty:uncertainty,expectedActiveTimeRatio:.6,dangerousRegimeMass:.1,reasonCodes:net>0?[]:['EXPECTED_NET_VALUE_NON_POSITIVE']});
const regime={transitionRisk:.1};
const now='2026-08-24T00:00:00.000Z',expiresAt='2026-08-24T01:00:00.000Z';

function rank(policyId,globalActionable=true,width=61){const c=candidate('candidate',width);return{c,r:rankCandidates({candidates:[c],simulations:[simulation(c.id)],survivalForecasts:{[c.id]:survival(c.id)},uncertainty:{[c.id]:.9},globalActionable,qualificationPolicyId:policyId})};}

test('candidate-primary B-50 economics passes +100 candidate / -40 global and rejects +40 / -100',()=>{
 const a=deriveQualificationEconomics(CANDIDATE_PRIMARY_RISK_ADJUSTED_QUALIFICATION_POLICY_V1,economics(-40),100);
 const b=deriveQualificationEconomics(CANDIDATE_PRIMARY_RISK_ADJUSTED_QUALIFICATION_POLICY_V1,economics(-100),40);
 assert.equal(a.globalRiskAdjustment,-20);assert.equal(a.riskAdjustedCandidateEV,80);
 assert.equal(b.globalRiskAdjustment,-50);assert.equal(b.riskAdjustedCandidateEV,-10);
});

test('candidate-primary selects a locally valid candidate despite negative global EV; legacy preserves block',()=>{
 const next=rank('candidate-primary-risk-adjusted-v1',false),legacy=rank('global-primary-v1',false);
 assert.equal(next.r.winner,next.c.id);assert.ok(!next.r.rankings[0].reasonCodes.includes('RANK_GLOBAL_ECONOMIC_BLOCK'));
 assert.equal(legacy.r.winner,'NO_TRADE');assert.ok(legacy.r.rankings[0].reasonCodes.includes('RANK_GLOBAL_ECONOMIC_BLOCK'));
});

test('candidate-primary high global uncertainty is soft context, not a thesis veto',()=>{
 const candidateQualification=deriveQualificationEconomics(CANDIDATE_PRIMARY_RISK_ADJUSTED_QUALIFICATION_POLICY_V1,economics(-.00004,.91),.0001);
 const result=deriveOpportunityProgress({pool,economics:economics(-.00004,.91),regime:{transitionRisk:.8},now,expiresAt,qualificationPolicy:CANDIDATE_PRIMARY_RISK_ADJUSTED_QUALIFICATION_POLICY_V1,candidateQualification,locallyActionableWinner:true});
 assert.equal(result.state,'QUALIFIED');assert.ok(result.reasonCodes.includes('FORECAST_UNCERTAINTY_HIGH_SOFT'));assert.ok(result.reasonCodes.includes('REGIME_TRANSITION_RISK_HIGH_SOFT'));
});

test('candidate-primary retains replay, survival, and pool-safety hard blocks',()=>{
 const q=deriveQualificationEconomics(CANDIDATE_PRIMARY_RISK_ADJUSTED_QUALIFICATION_POLICY_V1,economics(-.00004),.0001);
 assert.equal(deriveOpportunityProgress({pool,economics:economics(-.00004),regime,now,expiresAt,qualificationPolicy:CANDIDATE_PRIMARY_RISK_ADJUSTED_QUALIFICATION_POLICY_V1,candidateQualification:q,locallyActionableWinner:false}).state,'REJECTED');
 assert.equal(deriveOpportunityProgress({pool:{...pool,eligibility:'BLOCK',blockers:['SAFETY_TOXICITY_BLOCK']},economics:economics(-.00004),regime,now,expiresAt,qualificationPolicy:CANDIDATE_PRIMARY_RISK_ADJUSTED_QUALIFICATION_POLICY_V1,candidateQualification:q,locallyActionableWinner:true}).state,'REJECTED');
 const c=candidate(),bad={...simulation(c.id),evidenceActionable:false,warnings:['CANDIDATE_REPLAY_CONTINUITY_INSUFFICIENT']};
 const ranked=rankCandidates({candidates:[c],simulations:[bad],survivalForecasts:{[c.id]:survival(c.id)},qualificationPolicyId:'candidate-primary-risk-adjusted-v1'});
 assert.equal(ranked.winner,'NO_TRADE');assert.ok(ranked.rankings[0].reasonCodes.includes('CANDIDATE_REPLAY_CONTINUITY_INSUFFICIENT'));
});

test('global-primary-v1 retains global positivity and uncertainty behavior',()=>{
 const globalNegative=deriveOpportunityProgress({pool,economics:economics(-.00001),regime,now,expiresAt,qualificationPolicy:GLOBAL_PRIMARY_QUALIFICATION_POLICY_V1});
 const highUncertainty=deriveOpportunityProgress({pool,economics:economics(.00001,.8),regime,now,expiresAt,qualificationPolicy:GLOBAL_PRIMARY_QUALIFICATION_POLICY_V1});
 assert.equal(globalNegative.state,'REJECTED');assert.equal(highUncertainty.state,'WATCHING');
});

test('candidate-primary thesis exposes candidate, global, adjustment, and primary adjusted economics',async()=>{
 const {c,r}=rank('candidate-primary-risk-adjusted-v1',false,61);const global=economics(-.00004,.9);global.horizonMinutes=60;global.expectedFeeValue=.000001;global.expectedInventoryPnl=-.00002;global.expectedHodlRelativePnl=-.00002;global.expectedExecutionCost=.00001;global.expectedRepositionCost=0;global.expectedTailRiskCharge=0;
 const q=deriveQualificationEconomics(CANDIDATE_PRIMARY_RISK_ADJUSTED_QUALIFICATION_POLICY_V1,global,.0001);
 const thesis=await generateLpThesis({pool:{...pool,pool:'pool',policyId:'p',poolQualityScore:80,economicQualityScore:80,flowQualityScore:80,liquidityQualityScore:80,tokenRiskScore:80,archetype:'MATURE_DEEP',warnings:[],evidence:{},assessedAt:now},regime:{primary:'SIDEWAYS',probabilities:[{label:'SIDEWAYS',probability:.8}],confidence:.8,stability:.8,transitionRisk:.1,observedAt:now,reasonCodes:[],rawScores:{},evidence:{}},economics:global,candidate:c,ranking:r,survival:[survival(c.id)],observedAt:now,expiresAt,qualificationPolicy:CANDIDATE_PRIMARY_RISK_ADJUSTED_QUALIFICATION_POLICY_V1,qualificationEconomics:q,candidateEconomics:{feeValue:.00015,inventoryPnl:-.00002,executionCost:.00001,repositionCost:0,tailRiskCost:0,netValue:.0001}});
 assert.equal(thesis.expectedEconomics.qualificationPolicy,'candidate-primary-risk-adjusted-v1');assert.equal(thesis.expectedEconomics.economicAuthority,'CANDIDATE_PRIMARY');assert.equal(thesis.expectedEconomics.candidateExpectedNetEV,.0001);assert.equal(thesis.expectedEconomics.globalExpectedNetEV,-.00004);assert.equal(thesis.expectedEconomics.globalRiskAdjustmentWeight,.5);assert.equal(thesis.expectedEconomics.globalRiskAdjustmentValue,-.00002);assert.equal(thesis.expectedEconomics.riskAdjustedExpectedNetEV,.00008);assert.equal(thesis.expectedEconomics.netLpValue,.00008);
});

test('valid 50+ bin candidate remains eligible under candidate-primary',()=>{
 const {c,r}=rank('candidate-primary-risk-adjusted-v1',false,61);assert.equal(c.widthBins,61);assert.equal(r.winner,c.id);
});

test('frozen forward capture retains candidate-primary raw and adjusted authority fields',()=>{
 const frozen=freezePhase3ForwardDecision({artifact:{sourceSha:'a'.repeat(40),buildId:'b'.repeat(64),policyHash:'c'.repeat(64),migrationHead:'M0048_phase3_forward_outcome_v2_capital_constrained.sql'},recommendation:{recommendationId:'candidate-primary-forward',pool:'pool',decisionAt:now,state:'ENTRY_READY',reasonCodes:[],economics:{expectedFeeValue:0,expectedInventoryPnl:0,expectedExecutionCost:0,expectedRepositionCost:0,expectedTailRiskCharge:0,expectedNetLpValue:-.00004,expectedActiveTimeRatio:.6,forecastUncertainty:.9,evidenceFidelity:'EVENT_PATH_ESTIMATE'},ranking:{rankings:[]},qualification:{policyId:'candidate-primary-risk-adjusted-v1',economicAuthority:'CANDIDATE_PRIMARY',candidateExpectedNetEV:.0001,globalExpectedNetEV:-.00004,globalAdjustmentWeight:.5,globalRiskAdjustment:-.00002,riskAdjustedExpectedNetEV:.00008,uncertainty:.9,uncertaintyAuthority:'SOFT_CONTEXT',hardBlockReasons:[],softRiskReasons:['FORECAST_UNCERTAINTY_HIGH_SOFT']},thesis:{expectedEconomics:{netLpValue:.00008}},forwardValidation:{capitalLamports:'30000000',selectedCandidateKind:'NONE',costs:{},rawUnitValueX:1,rawUnitValueY:1,activeBinIdAtDecision:1,evidence:{}},}});
 assert.equal(frozen.prediction.qualificationPolicy,'candidate-primary-risk-adjusted-v1');assert.equal(frozen.prediction.expectedNetEv,.00008);assert.equal(frozen.prediction.globalRiskAdjustment,-.00002);assert.equal(frozen.prediction.uncertaintyAuthority,'SOFT_CONTEXT');
});
