import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { buildPhase3ForwardCalibration, freezePhase3ForwardDecision, matureFrozenPhase3ForwardOutcome, phase3ForwardOutcomeResultHash } from '../.build/packages/phase3-forward-validation/src/index.js';

const sha='a'.repeat(40),hash='b'.repeat(64),start='2026-08-23T00:00:00.000Z';
const at=minute=>new Date(Date.parse(start)+minute*60_000).toISOString();
const artifact={sourceSha:sha,buildId:hash,policyHash:'c'.repeat(64),migrationHead:'M0046_phase3_forward_outcome_result_hash.sql'};
const candidate={id:'frozen',family:'BASE',lowerBinId:10,upperBinId:10,centerBinId:10,widthBins:1,lowerOffsetBins:0,upperOffsetBins:0,lowerDistancePct:0,upperDistancePct:0,strategy:'SPOT',orientation:'BALANCED',capitalFraction:1,perBinWeights:[{binId:10,weight:1}],reasonCodes:[]};
const simulation={candidateId:'frozen',strategy:'SPOT',orientation:'BALANCED',activeTimeRatio:1,activeDurationMs:60_000,inactiveDurationMs:0,unobservedDurationMs:0,occupancyCoverageRatio:1,occupancyState:'COMPLETE',lowerExitCount:0,upperExitCount:0,feeValue:.01,inventoryChangeValue:0,grossValueChange:.01,totalCostValue:.001,netValue:.009,feeToAdverseInventoryRatio:null,fidelity:'EVENT_PATH_ESTIMATE',valueUnit:'TOKEN_X',capitalValue:.03,startInventoryValue:.03,normalizationScale:1,unitScaleValid:true,evidenceActionable:true,warnings:[]};
const baseRecommendation={recommendationId:'closure-rec',phase:'P3',recommendationOnly:true,decisionAt:start,expiresAt:at(5),pool:'pool-forward',state:'WATCHING',noTrade:true,marketContextHash:'context',regime:{transitionRisk:.2},economics:{expectedFeeValue:.001,expectedInventoryPnl:-.0001,expectedExecutionCost:.00001,expectedRepositionCost:.00002,expectedTailRiskCharge:.00003,expectedNetLpValue:.00084,expectedActiveTimeRatio:.6,forecastUncertainty:.7,evidenceFidelity:'EVENT_PATH_ESTIMATE'},uncertaintyLineage:{evidenceUncertainty:.2,forecastUncertainty:.7,components:{evidence:.2}},candidateCount:1,simulations:[simulation],ranking:{winner:'NO_TRADE',rankings:[{candidateId:'frozen',utility:.01}],reasonCodes:[]},forwardValidation:{version:'phase3-forward-decision-v1',horizonMinutes:30,capitalValue:.03,capitalLamports:'30000000',activeBinIdAtDecision:10,rawUnitValueX:.001,rawUnitValueY:.001,costs:{compositionFeeValue:'0',transactionFeeValue:'.00001',slippageValue:'0',rebalanceCostValue:'.00002',otherCostValue:'.00003'},selectedCandidateKind:'TOP_RANKED_COUNTERFACTUAL',selectedCandidate:candidate,selectedSimulation:simulation,selectedSurvival:{survivalProbability:.9},evidence:{replayAnchorAt:start,replayEvidenceWatermark:start,historicalFrameHash:'frame',historicalEventHash:'event'},wouldAugEraThesisSemanticsHaveCreatedThesis:true},reasonCodes:['SHADOW_NO_TRADE']};
const frame=(minute,activeBinId=10)=>({observedAt:at(minute),activeBinId,bins:[{binId:10,price:'1',amountX:'2000000',amountY:'2000000',liquiditySupply:'1000000'}]});
const completeFrames=Array.from({length:31},(_,minute)=>frame(minute));
const event=(minute=1,mmFee='1000')=>({signature:`event-${minute}-${mmFee}`,eventIndex:0,pool:'pool-forward',startBinId:10,endBinId:10,mmFee,feesOnTokenX:true,stamp:{source:'FIXTURE',observedAt:at(minute)},raw:{}});
const frozen=(overrides={})=>freezePhase3ForwardDecision({recommendation:{...baseRecommendation,...overrides},artifact});
const mature=(decision,frames=completeFrames,events=[event()],outcomeModelVersion)=>matureFrozenPhase3ForwardOutcome({decision,horizonMinutes:30,...(outcomeModelVersion?{outcomeModelVersion}:{}),frames,events,now:at(31)});
const key=v=>`${v.recommendationId}:${v.horizonMinutes}:${v.outcomeModelVersion}`;

class DurableFixtureStore {
  #rows=new Map();
  async ensure(recommendationId,horizonMinutes,outcomeModelVersion){const k=key({recommendationId,horizonMinutes,outcomeModelVersion});if(this.#rows.has(k))return false;this.#rows.set(k,{state:'PENDING'});return true;}
  async persist(outcome){const k=key(outcome),resultHash=await phase3ForwardOutcomeResultHash(outcome),current=this.#rows.get(k);assert.ok(current,'fixture outcome row missing');if(current.state==='FINAL'){if(current.evidenceHash!==outcome.evidenceHash||current.resultHash!==resultHash)throw new Error('LPFORGE_FORWARD_OUTCOME_EVIDENCE_OR_RESULT_HASH_CONFLICT');return false;}this.#rows.set(k,{state:outcome.state,evidenceHash:outcome.evidenceHash,resultHash,realized:outcome.realized});return true;}
  row(outcome){return this.#rows.get(key(outcome));}
  count(){return this.#rows.size;}
}

test('MAT-006 exact repeated maturation persists one durable outcome with stable hashes and values',async()=>{
 const decision=frozen(),outcome=await mature(decision),store=new DurableFixtureStore();await store.ensure(outcome.recommendationId,30,outcome.outcomeModelVersion);
 assert.equal(await store.persist(outcome),true);assert.equal(await store.persist(await mature(decision)),false);assert.equal(store.count(),1);assert.equal(store.row(outcome).resultHash,await phase3ForwardOutcomeResultHash(outcome));assert.deepEqual(store.row(outcome).realized,outcome.realized);
});

test('MAT-007 evidence or calculated-result conflict fails closed without overwrite',async()=>{
 const outcome=await mature(frozen()),store=new DurableFixtureStore();await store.ensure(outcome.recommendationId,30,outcome.outcomeModelVersion);await store.persist(outcome);
 const conflict={...outcome,evidenceHash:'f'.repeat(64),realized:{...outcome.realized,realizedNetValue:999}};await assert.rejects(store.persist(conflict),/EVIDENCE_OR_RESULT_HASH_CONFLICT/);assert.deepEqual(store.row(outcome).realized,outcome.realized);
});

test('MAT-008 restart before and after persistence recalculates safely and settles once',async()=>{
 const decision=frozen(),calculatedBeforeCrash=await mature(decision),recalculatedAfterRestart=await mature(decision),store=new DurableFixtureStore();assert.deepEqual(calculatedBeforeCrash,recalculatedAfterRestart);await store.ensure(decision.recommendationId,30,calculatedBeforeCrash.outcomeModelVersion);
 assert.equal(await store.persist(recalculatedAfterRestart),true);assert.equal(await store.persist(await mature(decision)),false);assert.equal(store.count(),1);
});

test('MAT-009 model versions coexist for one recommendation and horizon',async()=>{
 const decision=frozen(),v1=await mature(decision),v2=await mature(decision,completeFrames,[event()],'phase3-forward-outcome-v2'),store=new DurableFixtureStore();await store.ensure(decision.recommendationId,30,v1.outcomeModelVersion);await store.ensure(decision.recommendationId,30,v2.outcomeModelVersion);
 assert.equal(await store.persist(v1),true);assert.equal(await store.persist(v2),true);assert.equal(store.count(),2);assert.notEqual(store.row(v1).resultHash,store.row(v2).resultHash);
});

test('LOOK-001 excludes favourable evidence after the frozen 30 minute horizon',async()=>{
 const decision=frozen(),within=await mature(decision),after=await mature(decision,[...completeFrames,frame(31,10)],[event(),event(31,'999999999')]);assert.equal(within.evidenceHash,after.evidenceHash);assert.deepEqual(within.realized,after.realized);
});

test('LOOK-002 and LOOK-003 bind outcome to frozen geometry and selected candidate, never later range/ranking output',async()=>{
 const decision=frozen(),changedRangeForgeOutput={...candidate,id:'later-range',lowerBinId:0,upperBinId:100},changedRanking={winner:changedRangeForgeOutput.id,rankings:[{candidateId:changedRangeForgeOutput.id,utility:99}]};
 const outcome=await mature(decision,[frame(0,10),...Array.from({length:30},(_,i)=>frame(i+1,20))]);assert.equal(decision.selectedCandidate.id,'frozen');assert.equal(decision.selectedCandidate.lowerBinId,10);assert.equal(changedRanking.winner,'later-range');assert.equal(outcome.realized.rangeSurvived,false);
 const source=await readFile('packages/phase3-forward-validation/src/index.ts','utf8');assert.doesNotMatch(source,/range-forge|generateRange|rankCandidates/i);
});

test('LOOK-004 excludes evidence at or before decision time except the frozen valuation baseline',async()=>{
 const outcome=await mature(frozen(),completeFrames,[event(0,'999999999')]);assert.equal(outcome.state,'FINAL');assert.equal(outcome.realized.realizedFeeValue,0);
});

test('CAL-002 confusion matrix and progress-state cohorts include all four outcomes and WATCHING positives',()=>{
 const outcome=(recommendationId,net)=>({recommendationId,horizonMinutes:30,outcomeModelVersion:'phase3-forward-outcome-v1',state:'FINAL',reasonCodes:[],realized:{realizedNetValue:net}});
 const decision=(id,predicted,phase3State)=>({...frozen({recommendationId:id,state:phase3State,noTrade:phase3State!=='ENTRY_READY'}),phase3State,prediction:{...frozen().prediction,expectedNetEv:predicted}});
 const rows=[
  {decision:decision('nn',-.001,'REJECTED'),outcome:outcome('nn',-.001)},
  {decision:decision('np',-.001,'DATA_BLOCKED'),outcome:outcome('np',.001)},
  {decision:decision('pp',.001,'QUALIFIED'),outcome:outcome('pp',.001)},
  {decision:decision('pn',.001,'WATCHING'),outcome:outcome('pn',-.001)},
  {decision:decision('watch-positive',.001,'WATCHING'),outcome:outcome('watch-positive',.001)},
 ];
 const report=buildPhase3ForwardCalibration(rows);assert.equal(report.summary.predictedNegativeRealizedNegative,1);assert.equal(report.summary.predictedNegativeRealizedPositive,1);assert.equal(report.summary.predictedPositiveRealizedPositive,2);assert.equal(report.summary.predictedPositiveRealizedNegative,1);assert.equal(report.byHorizon['30'].progressStateCohorts.QUALIFIED.decisionCount,1);assert.equal(report.byHorizon['30'].positiveEvProgressStateCohorts.WATCHING.decisionCount,2);assert.equal(report.byHorizon['60'].summary.decisionCount,0);assert.equal(report.progressStateCohorts.DATA_BLOCKED.decisionCount,1);
});

test('forward-outcome SQL contract locks rows, rejects conflicts, and preserves versioned identities',async()=>{
 const db=await readFile('packages/db/src/index.ts','utf8'),migration=await readFile('packages/db/migrations/M0046_phase3_forward_outcome_result_hash.sql','utf8');assert.match(db,/FOR UPDATE/);assert.match(db,/LPFORGE_FORWARD_OUTCOME_EVIDENCE_OR_RESULT_HASH_CONFLICT/);assert.match(db,/ensurePhase3ForwardOutcome/);assert.match(migration,/result_hash/);
});
