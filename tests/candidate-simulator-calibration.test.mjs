import test from 'node:test';
import assert from 'node:assert/strict';
import {deriveSyntheticPositionShareRaw,simulateCandidateEconomics} from '../.build/packages/candidate-simulator/src/index.js';

const candidate={id:'calibration',family:'TEST',strategy:'SPOT',orientation:'BALANCED',lowerBinId:10,upperBinId:10,centerBinId:10,widthBins:1,lowerOffsetBins:0,upperOffsetBins:0,lowerDistancePct:0,upperDistancePct:0,reasonCodes:[],capitalFraction:1,perBinWeights:[{binId:10,weight:1}]};
const frame=(supply='1000000000000000000',amountX='900000000',amountY='800000000')=>({observedAt:'2026-08-21T00:00:00.000Z',activeBinId:10,bins:[{binId:10,price:'1',liquiditySupply:supply,amountX,amountY}]});
const simulate=(overrides={})=>simulateCandidateEconomics({candidate,pool:'P',frames:[frame(),{...frame(),observedAt:'2026-08-21T00:01:00.000Z'}],events:[{pool:'P',signature:'s',eventIndex:0,stamp:{observedAt:'2026-08-21T00:00:30.000Z'},startBinId:10,endBinId:10,mmFee:'100',feesOnTokenX:true}],totalPositionShareRaw:deriveSyntheticPositionShareRaw(frame()),rawUnitValueX:1e-9,rawUnitValueY:1e-9,capitalValue:1,...overrides});

test('initial-frame usable liquidity derives a positive deterministic bounded synthetic share',()=>{
 const f=frame(),share=deriveSyntheticPositionShareRaw(f);
 assert.ok(share>0n);assert.equal(share,deriveSyntheticPositionShareRaw(f));assert.ok(share<=BigInt(Number.MAX_SAFE_INTEGER));
});
test('liquidity-derived share prevents valid small synthetic replay inventory from truncating to zero',()=>{
 const result=simulate();
 assert.ok(result.startInventoryValue>0);assert.ok(result.normalizationScale>0);assert.equal(result.unitScaleValid,true);assert.equal(result.evidenceActionable,true);
});
test('missing usable liquidity, invalid valuation, and zero capital remain fail closed',()=>{
 assert.equal(deriveSyntheticPositionShareRaw(frame('0')),0n);
 assert.equal(simulate({totalPositionShareRaw:0n}).normalizationScale,0);
 assert.equal(simulate({rawUnitValueX:0}).unitScaleValid,false);
 assert.equal(simulate({capitalValue:0}).unitScaleValid,false);
});
