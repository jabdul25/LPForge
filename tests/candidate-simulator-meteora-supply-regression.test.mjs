import test from 'node:test';
import assert from 'node:assert/strict';
import {allocateSyntheticShares,deriveSyntheticPositionShareRaw,simulateCandidateEconomics} from '../.build/packages/candidate-simulator/src/index.js';

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
