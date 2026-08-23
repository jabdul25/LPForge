import test from 'node:test';
import assert from 'node:assert/strict';
import {allocateSyntheticShares,deriveSyntheticPositionShareRaw,simulateCandidateEconomics} from '../.build/packages/candidate-simulator/src/index.js';
import {prepareCandidateReplay} from '../.build/packages/shadow/src/index.js';

const candidate=(orientation)=>({id:`5pg-${orientation}`,family:'TEST',strategy:'SPOT',orientation,lowerBinId:-436,upperBinId:-436,centerBinId:-436,widthBins:1,lowerOffsetBins:0,upperOffsetBins:0,lowerDistancePct:0,upperDistancePct:0,reasonCodes:[],capitalFraction:1,perBinWeights:[{binId:-436,weight:1}]});
const frame=(supply,amountY)=>({observedAt:'2026-08-22T00:00:00.000Z',activeBinId:-436,bins:[{binId:-436,price:'0.01305813128887906097',amountX:'0',amountY,liquiditySupply:supply}]});
const simulate=(supply,amountY,orientation)=>{
  const first=frame(supply,amountY);
  return simulateCandidateEconomics({
    candidate:candidate(orientation),pool:'P',frames:[first,{...first,observedAt:'2026-08-22T00:01:00.000Z'}],
    events:[{pool:'P',signature:'s',eventIndex:0,stamp:{observedAt:'2026-08-22T00:00:30.000Z'},startBinId:-436,endBinId:-436,mmFee:'100',feesOnTokenX:false}],
    totalPositionShareRaw:deriveSyntheticPositionShareRaw(first),rawUnitValueX:1e-6,rawUnitValueY:6.796142615145634e-5,capitalValue:.03,
  });
};

test('5pg-shaped bin supply creates a positive exact synthetic share and usable normalized inventory',()=>{
  const supply='47593000067008977619962158185';
  const result=simulate(supply,'2582392845','BALANCED');
  assert.equal(deriveSyntheticPositionShareRaw(frame(supply,'2582392845')),(BigInt(supply)+999999n)/1000000n);
  assert.ok(result.startInventoryValue>0);
  assert.ok(result.normalizationScale>0);
  assert.equal(result.unitScaleValid,true);
  assert.equal(result.evidenceActionable,true);
});

test('FxPP-shaped supply remains mathematically valid for all candidate orientations',()=>{
  const supply='36497720608719997507383657959';
  for(const orientation of ['BALANCED','SKEWED_Y','ONE_SIDED_Y']){
    const result=simulate(supply,'1978588702',orientation);
    assert.ok(result.startInventoryValue>0,orientation);
    assert.ok(result.normalizationScale>0,orientation);
    assert.equal(result.unitScaleValid,true,orientation);
  }
});

test('missing or genuine zero supply remains fail closed',()=>{
  assert.equal(deriveSyntheticPositionShareRaw(frame('0','2582392845')),0n);
  assert.equal(simulate('0','2582392845','BALANCED').unitScaleValid,false);
});

test('U128 allocation is exact and a displaced current range replays at the historical anchor',()=>{
 const total=47593000067008977619962158185n,shares=allocateSyntheticShares(total,[{weight:.2},{weight:.3},{weight:.5}]);assert.equal(shares.reduce((a,b)=>a+b,0n),total);
 const bins=Array.from({length:73},(_,i)=>({binId:-456+i,price:'1',amountX:'500000000',amountY:'500000000',liquiditySupply:'47593000067008977619962158185'}));const frames=[0,15,30,45,60].map(minutes=>({observedAt:new Date(Date.parse('2026-08-22T00:00:00Z')+minutes*60000).toISOString(),activeBinId:-420,bins}));
 for(const strategy of ['SPOT','CURVE','BID_ASK'])for(const orientation of ['BALANCED','SKEWED_Y','ONE_SIDED_Y']){const c={...candidate(orientation),id:`${strategy}-${orientation}`,strategy,lowerBinId:70,upperBinId:130,centerBinId:100,widthBins:61,lowerOffsetBins:-30,upperOffsetBins:30,perBinWeights:Array.from({length:61},(_,i)=>({binId:70+i,weight:1/61}))};const r=simulateCandidateEconomics({candidate:c,pool:'P',frames,events:[{pool:'P',signature:'s',eventIndex:0,stamp:{observedAt:frames[1].observedAt},startBinId:-420,endBinId:-419,mmFee:'1000000',feesOnTokenX:true}],totalPositionShareRaw:deriveSyntheticPositionShareRaw(frames[0]),rawUnitValueX:1e-9,rawUnitValueY:1e-9,capitalValue:.03});assert.ok(r.startInventoryValue>0,`${strategy}/${orientation}`);assert.ok(r.normalizationScale>0,`${strategy}/${orientation}`);assert.equal(r.unitScaleValid,true,`${strategy}/${orientation}`);}
});


test('remainder never assigns a zero-weight terminal bin',()=>{
 const shares=allocateSyntheticShares(11n,[{weight:.5},{weight:.5},{weight:0}]);
 assert.deepEqual(shares,[5n,6n,0n]);
 assert.equal(shares.reduce((a,b)=>a+b,0n),11n);
});

const replayCandidate=(id,lower,upper)=>({id,family:'TEST',strategy:'SPOT',orientation:'BALANCED',lowerBinId:lower,upperBinId:upper,centerBinId:100,widthBins:upper-lower+1,lowerOffsetBins:lower-100,upperOffsetBins:upper-100,lowerDistancePct:0,upperDistancePct:0,reasonCodes:[],capitalFraction:1,perBinWeights:Array.from({length:upper-lower+1},(_,i)=>({binId:lower+i,weight:1/(upper-lower+1)}))});
const replayFrame=(minute,active,low,high,emptyRange)=>({observedAt:new Date(Date.parse('2026-08-22T00:00:00Z')+minute*60000).toISOString(),activeBinId:active,bins:Array.from({length:high-low+1},(_,i)=>{const binId=low+i,empty=emptyRange&&binId>=emptyRange[0]&&binId<=emptyRange[1];return{binId,price:'1',liquiditySupply:'1000000000000',amountX:empty?'0':'500000000',amountY:empty?'0':'500000000'};})});
test('candidate-specific replay holds fixed historical geometry rather than following later active bins',()=>{
 const frames=[replayFrame(0,100,65,135),replayFrame(15,105,65,135),replayFrame(30,110,65,135)];
 const input={historicalFrames:frames,decisionAt:frames[2].observedAt,horizonMinutes:30};
 const fixed=prepareCandidateReplay(input,replayCandidate('fixed',68,132));
 assert.equal(fixed.frames?.[0].activeBinId,100);
 assert.equal(fixed.frames?.length,3);
 assert.ok(fixed.frames?.every(frame=>frame.bins.some(bin=>bin.binId===68)&&frame.bins.some(bin=>bin.binId===132)));
});
test('candidate-specific replay anchors do not leak coverage to a wider fixed candidate',()=>{
 const frames=[replayFrame(0,100,65,135),replayFrame(15,105,65,135),replayFrame(30,110,73,143)];
 const input={historicalFrames:frames,decisionAt:frames[2].observedAt,horizonMinutes:30};
 const narrow=prepareCandidateReplay(input,replayCandidate('narrow',80,120));
 const wide=prepareCandidateReplay(input,replayCandidate('wide',68,132));
 assert.equal(narrow.frames?.length,3);
 assert.equal(wide.reason,'CANDIDATE_REPLAY_CONTINUITY_INSUFFICIENT');
});
test('candidate-specific preparations select the latest deterministic complete fixed-range horizon',()=>{
 const frames=[replayFrame(0,0,-20,20),replayFrame(15,0,-20,20),replayFrame(30,30,20,80),replayFrame(45,30,20,80)];
 const input={historicalFrames:frames,decisionAt:frames[3].observedAt,horizonMinutes:15};
 const lower=prepareCandidateReplay(input,replayCandidate('lower',85,95));
 const centered=prepareCandidateReplay(input,replayCandidate('centered',90,110));
 assert.equal(lower.frames?.[0].activeBinId,0);
 assert.equal(centered.frames?.[0].activeBinId,30);
});


const movingCandidate=(zeroFirst=false)=>({id:zeroFirst?'zero-edge':'moving-window',family:'TEST',strategy:'SPOT',orientation:'BALANCED',lowerBinId:68,upperBinId:132,centerBinId:100,widthBins:65,lowerOffsetBins:-32,upperOffsetBins:32,lowerDistancePct:0,upperDistancePct:0,reasonCodes:[],capitalFraction:1,perBinWeights:Array.from({length:65},(_,i)=>({binId:68+i,weight:zeroFirst&&i===0?0:1/(zeroFirst?64:65)}))});
const movingFrame=(minute,active,low,high)=>({observedAt:new Date(Date.parse('2026-08-22T00:00:00Z')+minute*60000).toISOString(),activeBinId:active,bins:Array.from({length:high-low+1},(_,i)=>({binId:low+i,price:'1',amountX:'500000000',amountY:'500000000',liquiditySupply:'47593000067008977619962158185'}))});
const denseFrames=frames=>frames.flatMap((frame,index)=>{const next=frames[index+1];if(!next)return[frame];const start=Date.parse(frame.observedAt),end=Date.parse(next.observedAt),extra=[];for(let stamp=start+5*60000;stamp<end;stamp+=5*60000)extra.push({...frame,observedAt:new Date(stamp).toISOString()});return[frame,...extra];});
const replayMoving=(candidate,frames)=>{const dense=denseFrames(frames);return simulateCandidateEconomics({candidate,pool:'moving',frames:dense,events:[{pool:'moving',signature:'moving',eventIndex:0,stamp:{observedAt:dense[1].observedAt},startBinId:100,endBinId:101,mmFee:'1000000',feesOnTokenX:true}],totalPositionShareRaw:deriveSyntheticPositionShareRaw(dense[0]),rawUnitValueX:1e-9,rawUnitValueY:1e-9,capitalValue:.03});};
test('moving bin windows fail closed rather than manufacturing an inventory loss',()=>{
 const frames=[movingFrame(0,100,65,135),movingFrame(15,108,73,143)];const result=replayMoving(movingCandidate(),frames);
 assert.equal(result.evidenceActionable,false);assert.ok(result.warnings.includes('CANDIDATE_REPLAY_CONTINUITY_INSUFFICIENT'));assert.equal(result.inventoryChangeValue,0);assert.equal(result.netValue,0);assert.ok(!result.warnings.includes('CANDIDATE_VALUE_CALIBRATION_INVALID'));
});
test('complete replay coverage remains actionable while bins outside the candidate range are irrelevant',()=>{
 for(const frames of [[movingFrame(0,100,65,135),movingFrame(15,108,65,135)],[movingFrame(0,100,65,135),movingFrame(15,108,68,132)]]){const result=replayMoving(movingCandidate(),frames);assert.equal(result.evidenceActionable,true);assert.ok(!result.warnings.includes('CANDIDATE_REPLAY_CONTINUITY_INSUFFICIENT'));}
});
test('temporary moving-window gaps and zero-weight edge bins preserve evidence semantics',()=>{
 const temporary=replayMoving(movingCandidate(),[movingFrame(0,100,65,135),movingFrame(15,108,73,143),movingFrame(30,100,65,135)]);assert.equal(temporary.evidenceActionable,false);assert.equal(temporary.inventoryChangeValue,0);
 const zeroEdge=replayMoving(movingCandidate(true),[movingFrame(0,100,65,135),movingFrame(15,108,69,132)]);assert.equal(zeroEdge.evidenceActionable,true);
});
test('a valid prepared replay never produces a fixed-geometry coverage warning in the simulator',()=>{
 const frames=denseFrames([movingFrame(0,100,65,135),movingFrame(15,105,65,135),movingFrame(30,110,65,135)]);
 const prepared=prepareCandidateReplay({historicalFrames:frames,decisionAt:frames.at(-1).observedAt,horizonMinutes:30},movingCandidate());
 assert.ok(prepared.frames);
 const result=replayMoving(movingCandidate(),prepared.frames);
 assert.equal(result.evidenceActionable,true);
 assert.ok(!result.warnings.includes('CANDIDATE_REPLAY_COVERAGE_INSUFFICIENT'));
 assert.ok(!result.warnings.includes('CANDIDATE_REPLAY_CONTINUITY_INSUFFICIENT'));
});
test('AUvX, 5pg, and FxPP-shaped hydrated windows remain valid with complete continuity',()=>{
 for(const [pool,supply] of [['AUvX','33613130275121993989002160'],['5pg','2882060171703985282476478'],['FxPP','3407759355809420208455944']]){const frames=[movingFrame(0,100,65,135),movingFrame(15,105,65,135)].map(frame=>({...frame,bins:frame.bins.map(bin=>({...bin,liquiditySupply:supply}))}));const result=replayMoving(movingCandidate(),frames);assert.equal(result.unitScaleValid,true,pool);assert.equal(result.evidenceActionable,true,pool);assert.ok(result.normalizationScale>0,pool);}
});
