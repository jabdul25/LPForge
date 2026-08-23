import test from 'node:test';
import assert from 'node:assert/strict';
import {pathBins,replaySyntheticInventory,attributeEventPathFees,simulateSyntheticPosition,summarizeRangeOutcome} from '../.build/packages/simulator/src/index.js';

const position={pool:'p',lowerBinId:99,upperBinId:101,openedAt:'2026-08-12T00:00:00Z',bins:[99,100,101].map(binId=>({binId,positionShareRaw:100n,competingSupplyRaw:900n}))};
const bins=(ids=[99,100,101])=>ids.map(binId=>({binId,price:'1',amountX:'1000',amountY:'1000',liquiditySupply:'900'}));
const frames=[
 {observedAt:'2026-08-12T00:00:00Z',activeBinId:100,bins:bins()},
 {observedAt:'2026-08-12T00:01:00Z',activeBinId:102,bins:bins()},
 {observedAt:'2026-08-12T00:02:00Z',activeBinId:100,bins:bins()},
];

test('pathBins is inclusive in both directions',()=>{assert.deepEqual(pathBins(1,3),[1,2,3]);assert.deepEqual(pathBins(3,1),[3,2,1]);});
test('synthetic inventory is deterministic and marks OOR/revisit',()=>{const inv=replaySyntheticInventory(position,frames);assert.equal(inv[0].tokenXRaw,300n);assert.equal(inv[1].inRange,false);const s=summarizeRangeOutcome(position,frames);assert.equal(s.lowerExitCount,0);assert.equal(s.upperExitCount,1);assert.equal(s.revisitCount,1);assert.equal(s.firstPassageSamples,1);});
test('event path fee attribution is explicitly approximate and uses liquidity share',()=>{const e={signature:'s',eventIndex:0,pool:'p',startBinId:99,endBinId:101,mmFee:'300',feesOnTokenX:true,stamp:{source:'FIXTURE',observedAt:'2026-08-12T00:01:00Z'},raw:{}};const [a]=attributeEventPathFees(position,[e]);assert.equal(a.fidelity,'EVENT_PATH_ESTIMATE');assert.equal(a.attributedLpFeeRaw,30n);assert.equal(a.feeToken,'X');});
test('simulation preserves warnings instead of claiming exact fee fidelity',()=>{const e={signature:'s',eventIndex:0,pool:'p',startBinId:99,endBinId:101,mmFee:'300',feesOnTokenX:true,stamp:{source:'FIXTURE',observedAt:'2026-08-12T00:01:00Z'},raw:{}};const r=simulateSyntheticPosition({position,frames,events:[e]});assert.equal(r.activeTimeRatio,.5);assert.equal(r.countWeightedActiveTimeRatio,2/3);assert.equal(r.activeDurationMs,60_000);assert.equal(r.inactiveDurationMs,60_000);assert.equal(r.totalAttributedFeeXRaw,30n);assert.ok(r.warnings.includes('SWAP2EVT_MM_FEE_IS_PATH_ALLOCATED_NOT_PER_BIN_EXACT'));});

import {analyzeActualPosition} from '../.build/packages/simulator/src/index.js';
test('actual position forensics uses on-chain observation fidelity',()=>{const r=analyzeActualPosition([{observedAt:'2026-08-12T00:00:00Z',activeBinId:100,lowerBinId:99,upperBinId:101,totalXRaw:100n,totalYRaw:0n,feeXRaw:0n,feeYRaw:0n,value:10,hodlBenchmarkValue:10},{observedAt:'2026-08-12T00:01:00Z',activeBinId:102,lowerBinId:99,upperBinId:101,totalXRaw:50n,totalYRaw:50n,feeXRaw:3n,feeYRaw:4n,value:11,hodlBenchmarkValue:12}]);assert.equal(r.fidelity,'ONCHAIN_POSITION');assert.equal(r.upperExitCount,1);assert.equal(r.feeXDeltaRaw,3n);assert.equal(r.hodlRelativePnl,-1);});
