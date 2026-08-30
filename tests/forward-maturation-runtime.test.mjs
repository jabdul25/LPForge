import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { FORWARD_MATURATION_RETRY_LIMIT, counterfactualV3ReservedSlots, deriveForwardMaturationRetryPlan, interleaveBoundedCounterfactualLanes, prioritizeForwardMaturationTasks, processDueForwardMaturations, startIndependentForwardMaturationLoop } from '../.build/apps/discovery-learning/src/forward-maturation-scheduler.js';

const task=(recommendationId,horizonMinutes,state='PENDING',extra={})=>({recommendationId,horizonMinutes,state,retryCount:0,...extra});
const key=row=>`${row.recommendationId}:${row.horizonMinutes}`;

class DurableQueueFixture {
  #rows=new Map();
  seed(row){this.#rows.set(key(row),{state:row.state,retryCount:row.retryCount??0,resultHash:row.resultHash});}
  row(task){return this.#rows.get(key(task));}
  async persist(task,result){
    const current=this.row(task);assert.ok(current,'fixture row missing');
    if(current.state==='FINAL')return{writeApplied:false,stateTransition:false,retryNoProgress:false};
    const stateTransition=current.state!==result.state,retryNoProgress=current.state==='INSUFFICIENT_EVIDENCE'&&result.state==='INSUFFICIENT_EVIDENCE';
    this.#rows.set(key(task),{...current,state:result.state,resultHash:result.resultHash??current.resultHash});
    return{writeApplied:true,stateTransition,retryNoProgress};
  }
}

test('queue starvation regression: due PENDING rows outrank old INSUFFICIENT_EVIDENCE retries',()=>{
  const insufficient=Array.from({length:12},(_,index)=>task(`old-insufficient-${index}`,30,'INSUFFICIENT_EVIDENCE',{retryCount:1,dueAt:'2026-08-23T00:00:00.000Z',nextRetryAt:'2026-08-23T01:00:00.000Z'}));
  const pending=Array.from({length:20},(_,index)=>task(`due-pending-${index}`,index%2?60:30,'PENDING',{dueAt:new Date(Date.parse('2026-08-23T00:10:00.000Z')+index*60_000).toISOString()}));
  const firstBatch=prioritizeForwardMaturationTasks([...insufficient,...pending]).slice(0,12);
  assert.equal(firstBatch.length,12);assert.ok(firstBatch.every(row=>row.state==='PENDING'));assert.deepEqual(firstBatch.map(row=>row.recommendationId),pending.slice(0,12).map(row=>row.recommendationId));
});

test('source SHA never reorders due PENDING work',()=>{
  const legacy=Array.from({length:20},(_,index)=>task(`legacy-${index}`,30,'PENDING',{sourceSha:'legacy',dueAt:new Date(Date.parse('2026-08-23T00:00:00.000Z')+index*60_000).toISOString()}));
  const current=Array.from({length:4},(_,index)=>task(`current-${index}`,30,'PENDING',{sourceSha:'current',dueAt:new Date(Date.parse('2026-08-23T01:00:00.000Z')+index*60_000).toISOString()}));
  const retry=task('current-retry',30,'INSUFFICIENT_EVIDENCE',{sourceSha:'current',nextRetryAt:'2026-08-23T00:00:00.000Z'});
  const firstBatch=prioritizeForwardMaturationTasks([...legacy,...current,retry]).slice(0,12);
  assert.deepEqual(firstBatch.map(row=>row.recommendationId),legacy.slice(0,12).map(row=>row.recommendationId));
  assert.equal(firstBatch.includes(retry),false);
});

test('M0054 fair scheduling reserves a bounded V3 lane without abandoning historical work',()=>{
  const v3=Array.from({length:40},(_,index)=>({lane:'V3',id:`v3-${index}`}));
  const historical=Array.from({length:100},(_,index)=>({lane:'HISTORICAL',id:`historical-${index}`}));
  const limit=30,reserved=counterfactualV3ReservedSlots(limit);
  assert.equal(reserved,20);
  const batch=interleaveBoundedCounterfactualLanes(v3.slice(0,reserved),historical.slice(0,limit-reserved),limit);
  assert.equal(batch.length,limit);
  assert.equal(batch.filter(row=>row.lane==='V3').length,reserved);
  assert.equal(batch.filter(row=>row.lane==='HISTORICAL').length,limit-reserved);
  assert.deepEqual(batch.slice(0,6).map(row=>row.lane),['V3','HISTORICAL','V3','HISTORICAL','V3','HISTORICAL']);
});

test('M0054 fair scheduling backfills unused V3 reservation and remains strictly bounded',()=>{
  const v3=[{lane:'V3',id:'v3-0'},{lane:'V3',id:'v3-1'}];
  const historical=Array.from({length:40},(_,index)=>({lane:'HISTORICAL',id:`historical-${index}`}));
  const limit=30,reserved=counterfactualV3ReservedSlots(limit);
  const batch=interleaveBoundedCounterfactualLanes(v3,historical.slice(0,limit-v3.length),limit);
  assert.equal(batch.length,limit);
  assert.equal(batch.filter(row=>row.lane==='V3').length,2);
  assert.equal(batch.filter(row=>row.lane==='HISTORICAL').length,28);
  assert.deepEqual(batch.slice(0,4).map(row=>row.lane),['V3','HISTORICAL','V3','HISTORICAL']);
  assert.ok(reserved<limit);
});

test('M0054 durable lane loader is V3-aware, bounded before raw-contract resolution, and fair across horizons',async()=>{
  const source=await readFile('packages/db/src/index.ts','utf8');
  assert.match(source,/CandidateCounterfactualQueueLane = 'ALL'\|'V3'\|'FULL_UNIVERSE'\|'HISTORICAL'/);
  assert.match(source,/v\.evaluation_schema_version='reset3c-universe-v3-decision-relevant'/);
  assert.match(source,/v\.evaluation_schema_version<>'reset3c-universe-v3-decision-relevant'/);
  assert.match(source,/WITH due AS MATERIALIZED/);
  assert.match(source,/ROW_NUMBER\(\) OVER \(PARTITION BY o\.horizon_minutes/);
  assert.match(source,/selected AS MATERIALIZED/);
  assert.match(source,/FROM due ORDER BY horizon_position,ready_at,horizon_minutes,capital_evaluation_id LIMIT \$2/);
  assert.match(source,/o\.created_at\+\(o\.horizon_minutes\|\|' minutes'\)::interval/);
  assert.match(source,/Math\.max\(1,Math\.min\(200,limit\)\)/);
});

test('INSUFFICIENT_EVIDENCE retries are bounded; terminal frozen-candidate gaps never retry',()=>{
  const at='2026-08-23T00:00:00.000Z';
  const retry=deriveForwardMaturationRetryPlan({priorState:'PENDING',resultState:'INSUFFICIENT_EVIDENCE',reasonCodes:['FORWARD_FUTURE_EVIDENCE_INSUFFICIENT'],retryCount:0,attemptedAt:at});
  assert.equal(retry.retryCount,1);assert.equal(retry.terminal,false);assert.equal(retry.nextRetryAt,'2026-08-23T00:15:00.000Z');
  const capped=deriveForwardMaturationRetryPlan({priorState:'INSUFFICIENT_EVIDENCE',resultState:'INSUFFICIENT_EVIDENCE',reasonCodes:['FORWARD_FUTURE_EVIDENCE_INSUFFICIENT'],retryCount:FORWARD_MATURATION_RETRY_LIMIT-1,attemptedAt:at});
  assert.equal(capped.retryCount,FORWARD_MATURATION_RETRY_LIMIT);assert.equal(capped.terminal,true);assert.equal(capped.nextRetryAt,undefined);
  const terminal=deriveForwardMaturationRetryPlan({priorState:'PENDING',resultState:'INSUFFICIENT_EVIDENCE',reasonCodes:['FORWARD_FROZEN_CANDIDATE_UNAVAILABLE'],retryCount:0,attemptedAt:at});
  assert.equal(terminal.terminal,true);assert.equal(terminal.nextRetryAt,undefined);
});

test('scheduler records state transitions separately from retry writes and keeps FINAL terminal',async()=>{
  const due30=task('due-30',30),due60=task('due-60',60),retry60=task('retry-60',60,'INSUFFICIENT_EVIDENCE',{retryCount:1,nextRetryAt:'2026-08-23T00:15:00.000Z'}),final30=task('final-30',30,'FINAL');
  const store=new DurableQueueFixture(),events=[];
  for(const row of [due30,due60,retry60,final30])store.seed(row);
  const mature=async row=>row.recommendationId==='due-30'||row.recommendationId==='final-30'?{state:'FINAL',resultHash:'final-hash'}:{state:'INSUFFICIENT_EVIDENCE',resultHash:'insufficient-hash',reasonCodes:['FORWARD_FUTURE_EVIDENCE_INSUFFICIENT']};
  const first=await processDueForwardMaturations({tasks:[due30,due60],mature,persist:(row,result)=>store.persist(row,result),emit:event=>events.push(event)});
  assert.deepEqual(first,{selected:2,attempted:2,stateTransitions:2,newFinal:1,newInsufficient:1,retryNoProgress:0,persistedWrites:2,due:2,processed:2,finalized:1,insufficient:1,failed:0,persisted:2});
  assert.equal(store.row(due30).state,'FINAL');assert.equal(store.row(due60).state,'INSUFFICIENT_EVIDENCE');
  const retry=await processDueForwardMaturations({tasks:[retry60],mature,persist:(row,result)=>store.persist(row,result),emit:event=>events.push(event)});
  assert.deepEqual(retry,{selected:1,attempted:1,stateTransitions:0,newFinal:0,newInsufficient:0,retryNoProgress:1,persistedWrites:1,due:1,processed:1,finalized:0,insufficient:0,failed:0,persisted:1});
  assert.equal(events.filter(event=>event.event==='FORWARD_MATURATION_RETRY_NO_PROGRESS').length,1);
  const final=await processDueForwardMaturations({tasks:[final30],mature,persist:(row,result)=>store.persist(row,result)});
  assert.equal(final.persistedWrites,0);assert.equal(final.stateTransitions,0);assert.equal(store.row(final30).state,'FINAL');
});

test('independent maturation loop runs while an unrelated learning cycle remains blocked',async()=>{
  let runs=0,resolveFirst;
  const first=new Promise(resolve=>{resolveFirst=resolve});
  const unrelatedLearningCycle=new Promise(()=>{});void unrelatedLearningCycle;
  const loop=startIndependentForwardMaturationLoop({intervalMs:30_000,run:async()=>{runs++;resolveFirst();},onError:error=>assert.fail(error)});
  await Promise.race([first,new Promise((_,reject)=>setTimeout(()=>reject(new Error('independent loop did not run')),250))]);
  assert.equal(runs,1);loop.stop();await loop.completed;
});

test('durable SQL queue selects only the canonical current V2 model and records explicit retry state',async()=>{
  const source=await readFile('packages/db/src/index.ts','utf8'),migration=await readFile('packages/db/migrations/M0047_phase3_forward_maturation_queue.sql','utf8');
  assert.match(source,/PHASE3_FORWARD_CURRENT_OUTCOME_MODEL_VERSION/);
  assert.match(source,/o\.outcome_model_version=\$3/);
  assert.match(source,/o\.state='PENDING' OR \(o\.state='INSUFFICIENT_EVIDENCE' AND o\.terminal_at IS NULL/);
  assert.match(source,/ORDER BY CASE WHEN o\.state='PENDING' THEN 0 ELSE 1 END ASC/);
  assert.doesNotMatch(source,/d\.source_sha=\$3/);
  assert.match(source,/next_retry_at/);assert.match(source,/retryNoProgress/);assert.match(migration,/next_retry_at/);assert.match(migration,/terminal_at/);
});

test('discovery-learning start wiring keeps forward maturation outside the long learning loop and has no source priority',async()=>{
  const source=await readFile('apps/discovery-learning/src/main.ts','utf8');
  assert.match(source,/startIndependentForwardMaturationLoop/);assert.match(source,/includeForwardMaturation:false/);assert.match(source,/deriveForwardMaturationRetryPlan/);assert.match(source,/FORWARD_MATURATION_FAILED/);
  assert.doesNotMatch(source,/LPFORGE_FORWARD_VALIDATION_PRIORITY_SOURCE_SHA/);
});

test('discovery-learning launcher does not inject a validation source priority',async()=>{
  const launcher=await readFile('scripts/start-lpforge-service.sh','utf8');
  assert.doesNotMatch(launcher,/LPFORGE_FORWARD_VALIDATION_PRIORITY_SOURCE_SHA/);
});

test('new forward decisions create only V2 work while V1 remains readable historical evidence',async()=>{
  const source=await readFile('packages/db/src/index.ts','utf8');
  assert.match(source,/for \(const horizonMinutes of \[30,60,120\]\) await db\.query\(/);
  assert.match(source,/\[v\.recommendationId,horizonMinutes,PHASE3_FORWARD_CURRENT_OUTCOME_MODEL_VERSION\]/);
  assert.match(source,/LPFORGE_FORWARD_OUTCOME_MODEL_RETIRED/);
});
