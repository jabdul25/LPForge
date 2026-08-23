import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { processDueForwardMaturations, startIndependentForwardMaturationLoop } from '../.build/apps/discovery-learning/src/forward-maturation-scheduler.js';

const task=(recommendationId,horizonMinutes)=>({recommendationId,horizonMinutes});

test('runtime maturation processes due 30m/60m rows, preserves a not-due 120m row, persists hashes, and remains idempotent',async()=>{
  const due30=task('due-30',30),due60=task('due-60',60),notDue120=task('not-due-120',120);
  const rows=new Map([[`${notDue120.recommendationId}:${notDue120.horizonMinutes}`,{state:'PENDING'}]]),events=[],calls=[];
  const mature=async row=>{calls.push(`${row.recommendationId}:${row.horizonMinutes}`);return row.horizonMinutes===30?{state:'FINAL',resultHash:'final-hash'}:{state:'INSUFFICIENT_EVIDENCE',resultHash:'insufficient-hash'};};
  const persist=async(row,result)=>{const key=`${row.recommendationId}:${row.horizonMinutes}`,prior=rows.get(key);if(prior?.state===result.state&&prior.resultHash===result.resultHash)return false;rows.set(key,{state:result.state,resultHash:result.resultHash});return true;};
  const first=await processDueForwardMaturations({tasks:[due30,due60],mature,persist,emit:event=>events.push(event)});
  assert.deepEqual(first,{due:2,processed:2,finalized:1,insufficient:1,failed:0,persisted:2});
  assert.deepEqual(calls,['due-30:30','due-60:60']);
  assert.deepEqual(rows.get('due-30:30'),{state:'FINAL',resultHash:'final-hash'});
  assert.deepEqual(rows.get('due-60:60'),{state:'INSUFFICIENT_EVIDENCE',resultHash:'insufficient-hash'});
  assert.deepEqual(rows.get('not-due-120:120'),{state:'PENDING'});
  assert.ok(events.some(event=>event.event==='FORWARD_MATURATION_DUE'));
  assert.ok(events.some(event=>event.event==='FORWARD_MATURATION_FINAL'));
  assert.ok(events.some(event=>event.event==='FORWARD_MATURATION_INSUFFICIENT'));
  assert.equal(events.filter(event=>event.event==='FORWARD_MATURATION_PERSISTED').length,2);
  const second=await processDueForwardMaturations({tasks:[due30,due60],mature,persist});
  assert.deepEqual(second,{due:2,processed:2,finalized:1,insufficient:1,failed:0,persisted:0});
  assert.equal(rows.size,3);
});

test('independent maturation loop runs while an unrelated learning cycle remains blocked',async()=>{
  let runs=0,resolveFirst;
  const first=new Promise(resolve=>{resolveFirst=resolve});
  const unrelatedLearningCycle=new Promise(()=>{});void unrelatedLearningCycle;
  const loop=startIndependentForwardMaturationLoop({intervalMs:30_000,run:async()=>{runs++;resolveFirst();},onError:error=>assert.fail(error)});
  await Promise.race([first,new Promise((_,reject)=>setTimeout(()=>reject(new Error('independent loop did not run')),250))]);
  assert.equal(runs,1);loop.stop();await loop.completed;
});

test('discovery-learning start wiring keeps forward maturation outside the long learning loop',async()=>{
  const source=await readFile('apps/discovery-learning/src/main.ts','utf8');
  assert.match(source,/startIndependentForwardMaturationLoop/);
  assert.match(source,/includeForwardMaturation:false/);
  assert.match(source,/FORWARD_MATURATION_FAILED/);
});
