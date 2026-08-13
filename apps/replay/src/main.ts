import { computeBinWindowFeatures, computeSwapFlowFeatures, finalizeFeatureSnapshot } from '../../../packages/features/src/index.js';
import { fixtureBins, fixturePool, fixtureSwaps } from '../../../packages/test-fixtures/src/index.js';
const result=await finalizeFeatureSnapshot(fixturePool.address,{slot:1000n},{bin:computeBinWindowFeatures(fixtureBins,fixturePool.activeBinId),flow:computeSwapFlowFeatures(fixtureSwaps)});console.log(JSON.stringify(result,(_,v)=>typeof v==='bigint'?v.toString():v,2));
