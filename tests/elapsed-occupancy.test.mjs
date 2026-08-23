import test from 'node:test';
import assert from 'node:assert/strict';
import { deriveElapsedOccupancy } from '../.build/packages/elapsed-occupancy/src/index.js';

const at=(minute)=>new Date(Date.parse('2026-08-23T00:00:00.000Z')+minute*60_000).toISOString();
const derive=(observations,options={})=>deriveElapsedOccupancy({observations,lowerBinId:10,upperBinId:10,horizonStart:at(0),horizonEnd:at(10),maximumAdmissibleGapMs:5*60_000,...options});

test('TIME-001 evenly spaced observations preserve count-equivalent elapsed occupancy',()=>{
 const result=derive([0,1,2,3,4,5,6,7,8,9,10].map(minute=>({observedAt:at(minute),activeBinId:minute%2?0:10})),{maximumAdmissibleGapMs:60_000});
 assert.equal(result.state,'COMPLETE');assert.equal(result.activeDurationMs,5*60_000);assert.equal(result.inactiveDurationMs,5*60_000);assert.equal(result.activeRatio,.5);
});
test('TIME-002 long inactive interval is elapsed time, not observation count',()=>{
 const result=derive([{observedAt:at(0),activeBinId:10},{observedAt:at(1),activeBinId:10},{observedAt:at(2),activeBinId:0},{observedAt:at(9),activeBinId:0},{observedAt:at(10),activeBinId:0}],{maximumAdmissibleGapMs:10*60_000});
 assert.equal(result.activeDurationMs,2*60_000);assert.equal(result.inactiveDurationMs,8*60_000);assert.equal(result.activeRatio,.2);
});
test('TIME-003 prolonged active interval is recognized by elapsed duration',()=>{
 const result=derive([{observedAt:at(0),activeBinId:0},{observedAt:at(1),activeBinId:10},{observedAt:at(9),activeBinId:10},{observedAt:at(10),activeBinId:0}],{maximumAdmissibleGapMs:10*60_000});
 assert.equal(result.activeDurationMs,9*60_000);assert.equal(result.inactiveDurationMs,1*60_000);assert.equal(result.activeRatio,.9);
});
test('TIME-004 large gaps become unobserved rather than active or inactive',()=>{
 const result=derive([{observedAt:at(0),activeBinId:10},{observedAt:at(10),activeBinId:10}],{maximumAdmissibleGapMs:2*60_000});
 assert.equal(result.activeDurationMs,2*60_000);assert.equal(result.unobservedDurationMs,8*60_000);assert.equal(result.state,'INSUFFICIENT_EVIDENCE');
});
test('TIME-005 final observation has no invented duration',()=>{
 const result=derive([{observedAt:at(0),activeBinId:10}]);
 assert.equal(result.observedDurationMs,0);assert.equal(result.activeRatio,undefined);assert.equal(result.state,'INSUFFICIENT_EVIDENCE');
});
test('TIME-006 duplicate equal states deduplicate deterministically',()=>{
 const result=derive([{observedAt:at(0),activeBinId:10},{observedAt:at(0),activeBinId:10},{observedAt:at(10),activeBinId:10}],{maximumAdmissibleGapMs:10*60_000});
 assert.equal(result.state,'COMPLETE');assert.equal(result.activeDurationMs,10*60_000);
});
test('TIME-007 conflicting duplicate states fail closed',()=>{
 const result=derive([{observedAt:at(0),activeBinId:10},{observedAt:at(0),activeBinId:0},{observedAt:at(10),activeBinId:10}]);
 assert.equal(result.state,'AMBIGUOUS');assert.ok(result.reasonCodes.includes('OCCUPANCY_DUPLICATE_TIMESTAMP_CONFLICT'));
});
test('TIME-008 out-of-order observations are sorted before interval construction',()=>{
 const result=derive([{observedAt:at(10),activeBinId:0},{observedAt:at(0),activeBinId:10},{observedAt:at(5),activeBinId:0}],{maximumAdmissibleGapMs:10*60_000});
 assert.equal(result.activeDurationMs,5*60_000);assert.equal(result.inactiveDurationMs,5*60_000);
});
test('TIME-009 exact horizon boundaries clip correctly',()=>{
 const result=derive([{observedAt:at(-1),activeBinId:10},{observedAt:at(0),activeBinId:10},{observedAt:at(10),activeBinId:0}],{maximumAdmissibleGapMs:20*60_000});
 assert.equal(result.activeDurationMs,10*60_000);assert.equal(result.unobservedDurationMs,0);
});
test('TIME-010 no valid observed interval has explicit insufficient evidence',()=>{
 const result=derive([{observedAt:'malformed',activeBinId:10},{observedAt:at(10),activeBinId:10}]);
 assert.equal(result.state,'AMBIGUOUS');assert.ok(result.reasonCodes.includes('OCCUPANCY_OBSERVATION_MALFORMED'));
});
test('TIME-011 partial horizon reports coverage separately from active ratio',()=>{
 const result=derive([{observedAt:at(0),activeBinId:10},{observedAt:at(1),activeBinId:10},{observedAt:at(10),activeBinId:0}],{maximumAdmissibleGapMs:2*60_000});
 assert.equal(result.activeDurationMs,3*60_000);assert.equal(result.coverageRatio,.3);assert.equal(result.activeRatio,1);assert.equal(result.state,'INSUFFICIENT_EVIDENCE');
});
test('TIME-012 production-shaped irregular cadence preserves exact covered durations',()=>{
 const result=derive([{observedAt:at(0),activeBinId:10},{observedAt:at(1),activeBinId:10},{observedAt:at(2),activeBinId:0},{observedAt:at(4),activeBinId:0},{observedAt:at(5),activeBinId:10}],{maximumAdmissibleGapMs:3*60_000});
 assert.equal(result.activeDurationMs,2*60_000);assert.equal(result.inactiveDurationMs,3*60_000);assert.equal(result.unobservedDurationMs,5*60_000);assert.equal(result.activeRatio,.4);
});
