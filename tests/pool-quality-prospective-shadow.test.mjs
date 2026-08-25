import test from 'node:test';
import assert from 'node:assert/strict';
import { derivePoolQualityProspectiveShadowSnapshot } from '../.build/packages/shadow/src/index.js';
import { buildPoolQualityProspectiveShadowReport, freezePhase3ForwardDecision } from '../.build/packages/phase3-forward-validation/src/index.js';

const artifact={sourceSha:'a'.repeat(40),buildId:'b'.repeat(64),policyHash:'c'.repeat(64),migrationHead:'M0048_phase3_forward_outcome_v2_capital_constrained.sql'};
const pool=(overrides={})=>({pool:'pool',eligibility:'ELIGIBLE',poolQualityScore:80,economicQualityScore:80,liquidityQualityScore:60,flowQualityScore:70,tokenRiskScore:80,toxicityProbability:.2,archetype:'UNKNOWN',dataQuality:'GOOD',blockers:[],warnings:[],evidence:{fee1hTvl:.03,fee24hTvl:.4},assessedAt:'2026-08-25T00:00:00.000Z',...overrides});
const recommendation=(id,poolAddress,snapshot)=>({recommendationId:id,decisionAt:'2026-08-25T00:00:00.000Z',pool:poolAddress,state:'ENTRY_READY',reasonCodes:[],economics:{expectedFeeValue:.0001,expectedInventoryPnl:0,expectedExecutionCost:.00001,expectedRepositionCost:0,expectedTailRiskCharge:0,expectedNetLpValue:.0001,expectedActiveTimeRatio:.6,forecastUncertainty:.7,evidenceFidelity:'EVENT_PATH_ESTIMATE'},ranking:{rankings:[]},forwardValidation:{capitalLamports:'30000000',selectedCandidateKind:'NONE',costs:{},rawUnitValueX:1,rawUnitValueY:1,activeBinIdAtDecision:1,evidence:{},poolQualityShadow:snapshot,wouldAugEraThesisSemanticsHaveCreatedThesis:false}});
const outcome=(recommendationId,state,net=0)=>({recommendationId,horizonMinutes:30,outcomeModelVersion:'phase3-forward-outcome-v2',state,reasonCodes:[],...(state==='FINAL'?{realized:{realizedFeeValue:net>0?net:0,realizedInventoryPnl:0,realizedExecutionCost:0,realizedRepositionCost:0,realizedTailRiskCost:0,realizedTotalCost:0,realizedNetValue:net,activeDurationMs:0,inactiveDurationMs:0,unobservedDurationMs:0,coverageRatio:1,rangeSurvived:true}}:{})});

test('pool-quality prospective cohorts use only frozen decision-time pool fields',()=>{
 const a=derivePoolQualityProspectiveShadowSnapshot(pool());
 assert.deepEqual(a.membership,{CONTROL:true,A:true,B:true,C:true});
 const weak=derivePoolQualityProspectiveShadowSnapshot(pool({economicQualityScore:74,toxicityProbability:.4,evidence:{fee1hTvl:.01,fee24hTvl:.4}}));
 assert.deepEqual(weak.membership,{CONTROL:true,A:false,B:false,C:false});
 assert.equal(weak.fee1hTvl,.01);
});

test('frozen decision retains cohort and same-cycle Phase-4 snapshot immutably',()=>{
 const snapshot=derivePoolQualityProspectiveShadowSnapshot(pool());
 const source=recommendation('pq-immutable','POOL_A',snapshot);
 const frozen=freezePhase3ForwardDecision({recommendation:source,artifact,phase4:{result:'WAIT',readinessScore:.7,timingConfidence:.12,reasonCodes:['WAIT_RECLAIM_NOT_CONFIRMED'],diagnostics:{immediateOorRisk:.2}}});
 source.forwardValidation.poolQualityShadow.membership.A=false;
 assert.equal(frozen.poolQualityShadow.membership.A,true);
 assert.equal(frozen.phase4.result,'WAIT');
 assert.equal(frozen.phase4.diagnostics.immediateOorRisk,.2);
});

test('prospective report separates CONTROL/A/B/C by horizon and pool without changing outcomes',()=>{
 const all=derivePoolQualityProspectiveShadowSnapshot(pool());
 const controlOnly=derivePoolQualityProspectiveShadowSnapshot(pool({economicQualityScore:60,evidence:{fee1hTvl:.01}}));
 const aOnly=derivePoolQualityProspectiveShadowSnapshot(pool({economicQualityScore:60,evidence:{fee1hTvl:.03}}));
 const d1=freezePhase3ForwardDecision({recommendation:recommendation('pq-1','ESR3',all),artifact});
 const d2=freezePhase3ForwardDecision({recommendation:recommendation('pq-2','AEUF',controlOnly),artifact});
 const d3=freezePhase3ForwardDecision({recommendation:recommendation('pq-3','8CSG',aOnly),artifact});
 const report=buildPoolQualityProspectiveShadowReport([{decision:d1,outcome:outcome('pq-1','FINAL',.0002)},{decision:d2,outcome:outcome('pq-2','FINAL',-.0001)},{decision:d3,outcome:outcome('pq-3','PENDING')}],{outcomeModelVersion:'phase3-forward-outcome-v2'});
 const h=report.byHorizon['30'];
 assert.equal(report.frozenDecisionCount,3);
 assert.equal(h.CONTROL.decisions,3);
 assert.equal(h.CONTROL.final,2);
 assert.equal(h.CONTROL.byPool.ESR3.wins,1);
 assert.equal(h.A.decisions,2);
 assert.equal(h.B.decisions,1);
 assert.equal(h.C.realizedEv,.0002);
 assert.equal(h.C.classification,'TOO_EARLY');
});
