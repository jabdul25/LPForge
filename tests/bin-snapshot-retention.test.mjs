import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { BIN_SNAPSHOT_OPERATIONAL_LOOKBACK_MS, binSnapshotProtectionPlan, boundedBinSnapshotRetentionDeleteLimit, runBoundedBinSnapshotRetention } from '../.build/apps/discovery-learning/src/bin-snapshot-retention.js';

const now='2026-08-28T12:00:00.000Z';

test('open selected 30m, 60m, and 120m outcomes retain their -15m baseline',()=>{
  for(const source of ['selectedForwardFloor','candidateCounterfactualFloor']){
    for(const horizon of [30,60,120]){
      const decision=`2026-08-28T0${horizon===30?'9':horizon===60?'8':'7'}:00:00.000Z`;
      const plan=binSnapshotProtectionPlan({now,[source]:new Date(Date.parse(decision)-15*60_000).toISOString()});
      assert.equal(plan.state,'READY',`${source}:${horizon}`);
      assert.equal(plan.protectionInputs[source==='selectedForwardFloor'?'SELECTED_FORWARD':'CANDIDATE_COUNTERFACTUAL'],new Date(Date.parse(decision)-15*60_000).toISOString());
    }
  }
});

test('M0052 preserves its 240-minute baseline and the four-hour live lookback remains protected',()=>{
  const plan=binSnapshotProtectionPlan({now,inventoryForecastV2Floor:'2026-08-28T05:30:00.000Z'});
  assert.equal(plan.state,'READY');
  assert.equal(plan.protectionFloor,'2026-08-28T05:30:00.000Z');
  const liveOnly=binSnapshotProtectionPlan({now});
  assert.equal(liveOnly.protectionFloor,new Date(Date.parse(now)-BIN_SNAPSHOT_OPERATIONAL_LOOKBACK_MS).toISOString());
});

test('the dynamic floor advances only after the oldest open validation dependency terminalizes',()=>{
  const whileOpen=binSnapshotProtectionPlan({now,candidateCounterfactualFloor:'2026-08-28T06:00:00.000Z'});
  const afterTerminal=binSnapshotProtectionPlan({now});
  assert.equal(whileOpen.protectionFloor,'2026-08-28T06:00:00.000Z');
  assert.equal(afterTerminal.protectionFloor,'2026-08-28T08:00:00.000Z');
  assert.ok(Date.parse(afterTerminal.protectionFloor)>Date.parse(whileOpen.protectionFloor));
});

test('unknown protection dependency fails closed and never deletes snapshots',async()=>{
  let deletes=0;
  const result=await runBoundedBinSnapshotRetention({now,store:{loadBinSnapshotRetentionPlan:async()=>({state:'UNKNOWN',protectionInputs:{},reasonCodes:['RETENTION_PROTECTION_FLOOR_UNKNOWN']}),deleteBinSnapshotsBefore:async()=>{deletes++;return{deleted:1};}}});
  assert.equal(result.state,'UNKNOWN');assert.equal(result.deleted,0);assert.equal(deletes,0);assert.equal(result.dryRun,false);
});

test('dry-run reports a dynamic floor but cannot delete a snapshot',async()=>{
  let deletes=0;
  const result=await runBoundedBinSnapshotRetention({now,dryRun:true,store:{loadBinSnapshotRetentionPlan:async()=>({state:'READY',protectionFloor:'2026-08-28T08:00:00.000Z',protectionInputs:{OPERATIONAL_HISTORY:'2026-08-28T08:00:00.000Z'},reasonCodes:[]}),deleteBinSnapshotsBefore:async()=>{deletes++;return{deleted:1};}}});
  assert.equal(result.state,'READY');assert.equal(result.dryRun,true);assert.equal(result.deleted,0);assert.equal(deletes,0);
});

test('bounded deletion receives the dynamic floor and can never exceed its configured cap',async()=>{
  let received;
  const result=await runBoundedBinSnapshotRetention({now,limit:99_999,store:{loadBinSnapshotRetentionPlan:async()=>({state:'READY',protectionFloor:'2026-08-28T05:00:00.000Z',protectionInputs:{OPERATIONAL_HISTORY:'2026-08-28T08:00:00.000Z'},reasonCodes:[]}),deleteBinSnapshotsBefore:async(floor,limit)=>{received={floor,limit};return{deleted:limit,oldestDeletedAt:'2026-08-20T00:00:00.000Z',newestDeletedAt:'2026-08-28T04:59:59.999Z'};}}});
  assert.deepEqual(received,{floor:'2026-08-28T05:00:00.000Z',limit:10_000});assert.equal(result.deleted,10_000);
  assert.equal(boundedBinSnapshotRetentionDeleteLimit(-1),1);assert.equal(boundedBinSnapshotRetentionDeleteLimit(20_000),10_000);
});

test('retention SQL is dynamic, fails closed on missing references, and deletes by bounded timestamp-indexed batches',async()=>{
  const db=await readFile('packages/db/src/index.ts','utf8'),main=await readFile('apps/discovery-learning/src/main.ts','utf8'),migration=await readFile('packages/db/migrations/M0057_bin_snapshot_retention_index.sql','utf8');
  assert.match(db,/research\.phase3_forward_outcomes/);assert.match(db,/research\.candidate_counterfactual_forward_outcomes/);assert.match(db,/research\.inventory_forecast_v2_activation/);
  assert.match(db,/RETENTION_CANDIDATE_DECISION_REFERENCE_MISSING/);assert.match(db,/WITH candidates AS MATERIALIZED/);assert.match(db,/observed_at<\$1::timestamptz ORDER BY observed_at ASC LIMIT \$2/);
  assert.match(main,/runBoundedBinSnapshotRetention/);assert.match(main,/LPFORGE_BIN_SNAPSHOT_RETENTION_MAX_DELETE/);
  assert.match(migration,/bin_snapshots_observed_at_idx/);assert.match(migration,/BEGIN;/);assert.match(migration,/COMMIT;/);
});
