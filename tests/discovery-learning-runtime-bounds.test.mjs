import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const read = path => readFile(path, 'utf8');

test('discovery-learning applies explicit bounded batch caps before recurring database work', async () => {
  const source = await read('apps/discovery-learning/src/main.ts');
  assert.match(source, /const bounded=.*Math\.max\(1,Math\.min\(max,Math\.floor\(value\)\)\)/);
  assert.match(source, /LPFORGE_FORWARD_VALIDATION_MAX_BATCH',12,50/);
  assert.match(source, /LPFORGE_RESET3C_COUNTERFACTUAL_MAX_BATCH',30,50/);
  assert.match(source, /LPFORGE_FORWARD_CALIBRATION_MAX_ROWS',500,1000/);
  assert.match(source, /LPFORGE_DISCOVERY_LEARNING_MAX_PREDICTIONS',500,1000/);
  assert.match(source, /LPFORGE_DISCOVERY_LEARNING_MAX_OUTCOMES',2000,5000/);
  assert.match(source, /LPFORGE_DISCOVERY_COUNTERFACTUAL_MAX_BATCH',5,25/);
  assert.match(source, /LPFORGE_LIVE_LEARNING_MAX_OUTCOMES',500,1000/);
  assert.doesNotMatch(source, /loadPhase3ForwardOutcomes\(5000\)/);
  assert.doesNotMatch(source, /loadRecentDiscoveryPredictions\(Number\(process\.env\.LPFORGE_DISCOVERY_LEARNING_MAX_PREDICTIONS\?\?5000\)\)/);
});

test('both selected and counterfactual forward queues run independently with bounded work only', async () => {
  const source = await read('apps/discovery-learning/src/main.ts');
  assert.match(source, /maturePhase3ForwardOutcomes\(store,now,\{includeCalibration:false\}\)/);
  assert.match(source, /await matureCandidateCounterfactualOutcomes\(store,now\)/);
  assert.match(source, /if\(options\.includeCalibration===false\).*deferredToBoundedLearningCycle/s);
  assert.match(source, /counterfactualV3ReservedSlots\(batchLimit\)/);
  assert.match(source, /loadDueCandidateCounterfactualOutcomes\(now,v3Limit,'V3'\)/);
  assert.match(source, /loadDueCandidateCounterfactualOutcomes\(now,batchLimit-v3Rows\.length,'HISTORICAL'\)/);
  assert.match(source, /v3Failures=await matureCandidateCounterfactualRows\(store,v3Rows,now\)/);
  assert.match(source, /historicalRows=await store\.loadDueCandidateCounterfactualOutcomes\(now,batchLimit-v3Rows\.length,'HISTORICAL'\),historicalFailures=await matureCandidateCounterfactualRows\(store,historicalRows,now\)/);
  assert.match(source, /COUNTERFACTUAL_MATURATION_RUNTIME_ERROR/);
  assert.match(source, /runBoundedBinSnapshotRetention/);
  assert.match(source, /LPFORGE_BIN_SNAPSHOT_RETENTION_MAX_DELETE/);
  assert.doesNotMatch(source, /Promise\.all\([^)]*loadOperationalHistory/);
});

test('counterfactual API work is due-only and stops the batch at an upstream rate limit', async () => {
  const source = await read('apps/discovery-learning/src/main.ts');
  const db = await read('packages/db/src/index.ts');
  assert.match(source, /loadDueDiscoveryCounterfactualPredictions\(now,counterfactualLimit\)/);
  assert.match(source, /rateLimited\(error\).*break predictions/s);
  assert.match(source, /DISCOVERY_COUNTERFACTUAL_RATE_LIMITED/);
  assert.match(db, /async loadDueDiscoveryCounterfactualPredictions\(now,limit\)/);
  assert.match(db, /Math\.max\(1,Math\.min\(25,Math\.floor\(limit\)\)\)/);
  assert.match(db, /ORDER BY p\.observed_at ASC,p\.prediction_id ASC LIMIT \$2/);
});

test('post-entry episode creation is paged rather than an unbounded recurring historical scan', async () => {
  const capture = await read('apps/discovery-learning/src/post-entry-telemetry-capture.ts');
  const db = await read('packages/db/src/index.ts');
  assert.match(capture, /preparePostEntryTelemetryEpisodes\(input\.now,limit\)/);
  assert.match(db, /async preparePostEntryTelemetryEpisodes\(capturedAt,limit=100\)/);
  const start = db.indexOf('async preparePostEntryTelemetryEpisodes(capturedAt,limit=100)');
  const end = db.indexOf('async loadDuePostEntryTelemetryCheckpoints', start);
  assert.ok(start >= 0 && end > start);
  const section = db.slice(start, end);
  assert.match(section, /ORDER BY d\.decision_at ASC LIMIT \$2/);
  assert.match(section, /Math\.max\(1,Math\.min\(500,Math\.floor\(limit\)\)\)/);
});

test('runtime diagnostics are opt-in and do not introduce policy consumers', async () => {
  const source = await read('apps/discovery-learning/src/main.ts');
  assert.match(source, /LPFORGE_DISCOVERY_LEARNING_MEMORY_DIAGNOSTICS/);
  assert.match(source, /RESEARCH_ONLY_NO_POLICY_MUTATION/);
  assert.doesNotMatch(source, /rankCandidates\(/);
  assert.doesNotMatch(source, /execution.*enable|enable.*execution/i);
});
