import test from 'node:test';
import assert from 'node:assert/strict';
import {assertPhase3EvidenceWidth,derivePhase3EvidenceWidthRequirement,generateStrategyCandidates} from '../.build/packages/rangeforge/src/index.js';
import {deriveSyntheticPositionShareRaw,simulateCandidateEconomics} from '../.build/packages/candidate-simulator/src/index.js';
import {prepareCandidateReplay} from '../.build/packages/shadow/src/index.js';

const stamp=minute=>new Date(Date.parse('2026-08-22T00:00:00.000Z')+minute*60_000).toISOString();
const frame=(minute,active,radius)=>({observedAt:stamp(minute),activeBinId:active,bins:Array.from({length:radius*2+1},(_,i)=>({binId:active-radius+i,price:'1',amountX:'500000000',amountY:'500000000',liquiditySupply:'47593000067008977619962158185'}))});
const universe={activeBinId:100,binStep:20,horizonMinutes:60,candidates:[{id:'defensive-99-49-49',family:'DEFENSIVE',lowerBinId:51,upperBinId:149,centerBinId:100,widthBins:99,lowerOffsetBins:-49,upperOffsetBins:49,lowerDistancePct:0,upperDistancePct:0,reasonCodes:[]}],movementBasisBins:26,volatilityMultiplier:1};
const input=frames=>({historicalFrames:frames,decisionAt:frames.at(-1).observedAt,horizonMinutes:60});

test('Phase-3 evidence width is derived from executable width and rejects the former 73-bin collector frame',()=>{
 const requirement=derivePhase3EvidenceWidthRequirement(100);
 assert.deepEqual(requirement,{maxExecutableRangeWidthBins:100,effectiveCandidateWidthBins:99,maximumCandidateReachBins:98,replayMovementMarginBins:49,requiredEvidenceRadius:147,requiredFrameWidthBins:295});
 assert.throws(()=>assertPhase3EvidenceWidth({binRadius:35,maxExecutableRangeWidthBins:100}),/PHASE3_EVIDENCE_WIDTH_INSUFFICIENT_FOR_RANGE_POLICY/);
 assert.deepEqual(assertPhase3EvidenceWidth({binRadius:147,maxExecutableRangeWidthBins:100}),requirement);
});

test('99-bin 5A15-shaped candidate needs more than a 73-bin frame and prepares with policy-derived evidence width',()=>{
 const candidate={...universe.candidates[0],id:'defensive-99-57-41-spot-balanced-1000',lowerBinId:-1127,upperBinId:-1029,centerBinId:-1070,lowerOffsetBins:-57,upperOffsetBins:41,strategy:'SPOT',orientation:'BALANCED',capitalFraction:1,perBinWeights:Array.from({length:99},(_,i)=>({binId:-1127+i,weight:1/99}))};
 const narrow=Array.from({length:13},(_,index)=>frame(index*5,-1070,35));
 assert.equal(prepareCandidateReplay(input(narrow),candidate).reason,'CANDIDATE_REPLAY_COVERAGE_INSUFFICIENT');
 const wide=Array.from({length:13},(_,index)=>frame(index*5,-1070,147)),prepared=prepareCandidateReplay(input(wide),candidate);
 assert.equal(prepared.frames?.length,13);
 const simulated=simulateCandidateEconomics({candidate,pool:'5A15',frames:prepared.frames,events:[{pool:'5A15',signature:'s',eventIndex:0,stamp:{observedAt:stamp(15)},startBinId:-1070,endBinId:-1069,mmFee:'1000000',feesOnTokenX:true}],totalPositionShareRaw:deriveSyntheticPositionShareRaw(prepared.frames[0]),rawUnitValueX:1e-9,rawUnitValueY:1e-9,capitalValue:.03});
 assert.ok(simulated.normalizationScale>0);assert.equal(simulated.unitScaleValid,true);assert.equal(simulated.evidenceActionable,true);
});

test('all nine configured families are simulatable with a 99-bin fixed position and bounded policy movement',()=>{
 const requirement=derivePhase3EvidenceWidthRequirement(100),active=[100,125,75,149,51],frames=Array.from({length:13},(_,index)=>frame(index*5,active[Math.min(active.length-1,Math.floor(index/3))],requirement.requiredEvidenceRadius));
 const candidates=generateStrategyCandidates({universe,strategyOrientations:{SPOT:['BALANCED','SKEWED_Y','ONE_SIDED_Y'],CURVE:['BALANCED','SKEWED_Y','ONE_SIDED_Y'],BID_ASK:['BALANCED','SKEWED_Y','ONE_SIDED_Y']}});
 assert.equal(candidates.length,9);
 for(const candidate of candidates){const prepared=prepareCandidateReplay(input(frames),candidate);assert.ok(prepared.frames,`${candidate.strategy}/${candidate.orientation}`);const result=simulateCandidateEconomics({candidate,pool:'P',frames:prepared.frames,events:[{pool:'P',signature:candidate.id,eventIndex:0,stamp:{observedAt:stamp(15)},startBinId:100,endBinId:101,mmFee:'1000000',feesOnTokenX:true}],totalPositionShareRaw:deriveSyntheticPositionShareRaw(prepared.frames[0]),rawUnitValueX:1e-9,rawUnitValueY:1e-9,capitalValue:.03});assert.ok(result.normalizationScale>0,`${candidate.strategy}/${candidate.orientation}`);assert.equal(result.unitScaleValid,true,`${candidate.strategy}/${candidate.orientation}`);assert.equal(result.evidenceActionable,true,`${candidate.strategy}/${candidate.orientation}`);}
});

test('movement beyond the policy-derived margin remains explicit replay continuity insufficiency',()=>{
 const requirement=derivePhase3EvidenceWidthRequirement(100),candidate=generateStrategyCandidates({universe,strategyOrientations:{SPOT:['ONE_SIDED_Y']}})[0],frames=Array.from({length:13},(_,index)=>frame(index*5,index<3?100:index<6?250:100,requirement.requiredEvidenceRadius));
 assert.equal(prepareCandidateReplay(input(frames),candidate).reason,'CANDIDATE_REPLAY_CONTINUITY_INSUFFICIENT');
});
