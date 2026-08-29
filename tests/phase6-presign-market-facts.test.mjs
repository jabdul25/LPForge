import test from 'node:test';
import assert from 'node:assert/strict';
import {readOpenPresignMarketFacts} from '../.build/packages/phase6-live-worker/src/index.js';

const base={rpcUrl:'http://unused',programId:'program',poolAddress:'pool',plannedActiveBinId:100,plannedBinStep:80,lowerBinId:96,upperBinId:104};
test('pre-sign market read uses current on-chain active bin and derives a bps divergence',async()=>{
 const result=await readOpenPresignMarketFacts({...base,adapter:{getPool:async()=>({binStep:80}),getActiveBin:async()=>({binId:103})}});
 assert.deepEqual(result,{activeBinId:103,referenceDivergenceBps:240,outsidePlannedRange:false});
});
test('pre-sign market read fails closed on bin-step mismatch or range exit',async()=>{
 await assert.rejects(()=>readOpenPresignMarketFacts({...base,adapter:{getPool:async()=>({binStep:100}),getActiveBin:async()=>({binId:100})}}),/PRESIGN_BIN_STEP_MISMATCH/);
 const result=await readOpenPresignMarketFacts({...base,adapter:{getPool:async()=>({binStep:80}),getActiveBin:async()=>({binId:105})}});
 assert.equal(result.outsidePlannedRange,true);
});
