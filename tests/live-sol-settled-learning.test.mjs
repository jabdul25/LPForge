import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import { calibrateLiveSettledOutcomes } from '../.build/packages/discovery-learning/src/index.js';

const sample=(overrides={})=>({
  outcomeId:'outcome-1', predictionId:'recommendation-1', poolAddress:'pool-1', strategy:'CENTER', entryRegime:'CONSOLIDATION',
  entryAt:'2026-08-16T00:00:00.000Z', realizedSolPnlLamports:1_000_000n, predictedNetSolLamports:900_000n,
  predictedProfitProbability:.8, outcomeKind:'LIVE_SOL_SETTLED', ...overrides,
});

test('Gap 10: an immutable SOL_SETTLED profit is calibrated from realized lamports',()=>{
  const r=calibrateLiveSettledOutcomes([sample()]);
  assert.equal(r.samples,1);assert.equal(r.profitableCount,1);assert.equal(r.lossCount,0);assert.equal(r.netPnlMaeLamports,100_000);
});
test('Gap 10: a terminal loss overrides any earlier MTM and is the only learned result',()=>{
  const r=calibrateLiveSettledOutcomes([sample({realizedSolPnlLamports:-500_000n,predictedNetSolLamports:900_000n})]);
  assert.equal(r.lossCount,1);assert.equal(r.netPnlMaeLamports,1_400_000);assert.ok(Math.abs((r.brierProfit??0)-.64)<1e-12);
});
test('Gap 10: cohort calibration retains effective episode rather than raw action count',()=>{
  const r=calibrateLiveSettledOutcomes([sample(),sample({outcomeId:'outcome-2',predictionId:'recommendation-2',realizedSolPnlLamports:-1n})]);
  assert.equal(r.samples,2);assert.equal(r.independentEpisodes,1);assert.equal(r.byCohort[0].independentEpisodes,1);
});
test('Gap 10: source accepts only SOL_SETTLED lifecycle rows for successful terminal outcomes',()=>{
  const source=fs.readFileSync('packages/db/src/index.ts','utf8');
  assert.match(source,/WHERE l\.position_address=\$1 AND l\.status='SOL_SETTLED'/);
  assert.match(source,/loadPendingLiveSolSettledLearningOutcomes/);
  assert.match(source,/t\.thesis AS thesis_payload/);
  assert.match(source,/terminalAuthority:'SOL_SETTLED_ONLY'/);
  assert.match(source,/originalPrediction:\{recommendationId:row\.recommendation_id/);
});
test('Gap 10: immutable outcome schema prevents duplicates, mutation, and keeps aborted entries distinct',()=>{
  const sql=fs.readFileSync('packages/db/migrations/M0042_live_sol_settled_learning.sql','utf8');
  assert.match(sql,/LIVE_SOL_SETTLED/);assert.match(sql,/LIVE_ENTRY_ABORTED_SOL_SETTLED/);
  assert.match(sql,/live_learning_outcomes_kind_entry_plan_uq/);assert.match(sql,/prevent_live_learning_outcome_mutation/);
  assert.match(sql,/UNIQUE\(entry_plan_id\)/);
});
test('Gap 10: fee and management evidence comes from lifecycle cashflows and linked plans',()=>{
  const source=fs.readFileSync('packages/db/src/index.ts','utf8');
  assert.match(source,/\['FEE_CLAIM','REWARD_CLAIM'\]/);assert.match(source,/lifecycle_plan_links/);
  assert.match(source,/counts\('CLAIM'\)/);assert.match(source,/counts\('RESHAPE'\)/);
});
test('Gap 10: failed entry recovery produces its own terminal, idempotent learning outcome',()=>{
  const source=fs.readFileSync('packages/db/src/index.ts','utf8');
  const worker=fs.readFileSync('packages/phase6-live-worker/src/index.ts','utf8');
  assert.match(source,/createLiveEntryAbortedLearningOutcome/);assert.match(source,/ABORTED_SOL_SETTLED/);
  assert.match(worker,/P6_PARTIAL_ABORTED_SOL_SETTLED_LEARNING_RECORDED/);
});
test('Gap 10: calibration is research-only and has no production-policy writer',()=>{
  const app=fs.readFileSync('apps/discovery-learning/src/main.ts','utf8');
  assert.match(app,/RESEARCH_ONLY_NO_POLICY_MUTATION/);assert.match(app,/calibrateLiveSettledOutcomes/);
  assert.match(app,/pendingSettlements/);
  assert.doesNotMatch(app,/updateProductionPolicy|writeProductionPolicy|enablePlanDispatch/);
});
