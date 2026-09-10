import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

test('a reconciled OPEN resolves a partial-entry row only when construction and an exact owned-position binding prove the entry', () => {
  const worker = fs.readFileSync('packages/phase6-live-worker/src/index.ts', 'utf8');
  const loadPlan = worker.indexOf('const plan = await input.store.loadAutonomousPlan(planId);');
  const construction = worker.indexOf('const plannedChunks=plan?.action===\'OPEN\'?', loadPlan);
  const reconciled = worker.indexOf('plan?.action === "OPEN" && plan.state === "RECONCILED" && constructionComplete && plan.positionOpenReconciled', loadPlan);
  const partialHold = worker.indexOf("P6_PARTIAL_ENTRY_REQUIRES_POSITION_RECOVERY", loadPlan);
  const unwindSubmitted = worker.indexOf('if (state === "UNWIND_SUBMITTED")', loadPlan);
  const genericUnwindHold = worker.indexOf('state !== "UNWIND_REQUIRED"', loadPlan);
  assert.ok(loadPlan >= 0 && construction > loadPlan && reconciled > construction, 'recovery must check construction and an authoritative owned-position binding first');
  assert.ok(partialHold > reconciled && partialHold < unwindSubmitted && partialHold < genericUnwindHold, 'incomplete construction remains in protective recovery rather than becoming ordinary OPEN');
  assert.match(worker, /P6_PARTIAL_RECOVERY_SUPERSEDED_BY_SUCCESSFUL_ENTRY/);
  assert.match(worker, /state: "SUPERSEDED_BY_SUCCESSFUL_ENTRY"/);
  assert.match(worker, /A payload address alone is never sufficient/);
  assert.match(worker, /positionOpenReconciled/);
  assert.match(worker, /supersedeProvisionalPartialEntryRecovery/);
});

test('the durable partial-entry recovery state contract permits receipt-bound successful-entry supersession', () => {
  const migration = fs.readFileSync('packages/db/migrations/M0072_partial_entry_success_supersession.sql', 'utf8');
  assert.match(migration, /DROP CONSTRAINT IF EXISTS partial_entry_recovery_state_check/);
  assert.match(migration, /SUPERSEDED_BY_SUCCESSFUL_ENTRY/);
  assert.match(migration, /BEGIN;/);
  assert.match(migration, /COMMIT;/);
});

test('successful-open cleanup explicitly types the recovery supersession timestamp', () => {
  const store = fs.readFileSync('packages/db/src/index.ts', 'utf8');
  const start = store.indexOf('async supersedePartialEntryRecoveryIfSuccessfulOpen(v)');
  const end = store.indexOf('async upsertOpenChunkDisposition(v)', start);
  assert.ok(start >= 0 && end > start, 'the successful-open cleanup query must exist');
  const query = store.slice(start, end);
  assert.match(query, /'at',\$5::timestamptz/);
  assert.match(query, /updated_at=\$5::timestamptz/);
  assert.doesNotMatch(query, /'at',\$5\)(?!::timestamptz)/);
});

test('autonomous plan mapping preserves the durable transaction-plan state', () => {
  const store = fs.readFileSync('packages/db/src/index.ts', 'utf8');
  assert.match(store, /state: String\(row\.state\)/);
  const planQueries = store.match(/SELECT p\.plan_id,p\.intent_id,p\.state,p\.expires_at/g) ?? [];
  assert.ok(planQueries.length >= 3, 'claim, direct load, and recovery scans must all map plan state');
  assert.match(store, /position_open_reconciled/);
  assert.match(store, /OWNED_OPEN_RECONCILED/);
  assert.match(store, /SUPERSEDED_BY_SUCCESSFUL_ENTRY/);
  assert.match(store, /supersedePartialEntryRecoveryIfSuccessfulOpen/);
});

test('P6 ticket position capacity is supplied by runtime policy rather than a hard-coded value', () => {
  const worker = fs.readFileSync('packages/phase6-live-worker/src/index.ts', 'utf8');
  const execution = fs.readFileSync('apps/execution/src/main.ts', 'utf8');
  assert.match(worker, /executionMaxOpenPositions\(input\.config\)/);
  assert.match(worker, /LPFORGE_P6_RUNTIME_POSITION_LIMIT_INVALID/);
  assert.doesNotMatch(worker, /maxOpenPositions: 1/);
  assert.match(execution, /maxOpenPositions: policy\.maxOpenPositions/);
});

test('confirmed funding uses fresh post-funding simulation authority and cannot be reported as a zero-effect block', () => {
  const worker = fs.readFileSync('packages/phase6-live-worker/src/index.ts', 'utf8');
  const funding = worker.indexOf('submittedAny = true;\n      lastSignature = funded.signature;');
  const postFundingSimulation = worker.indexOf('const simulatedAt = new Date().toISOString(),', funding);
  assert.ok(funding >= 0 && postFundingSimulation > funding, 'a confirmed funding signature must be tracked before post-funding work');
  assert.match(worker, /P6_CONFIRMED_FUNDING_PARTIAL_ENTRY/);
  assert.match(worker, /if\(submittedAny\|\|submissionStatusUnknown\|\|fundingSubmitted\)/, 'chunked opens must also preserve confirmed funding as a partial economic effect');
  assert.match(worker, /simulatedAt,\n        input\.config\.riskPermitTtlMs/);
});

test('an expired chunked OPEN can be reconciled only from its original children, never by a replacement add', () => {
  const worker = fs.readFileSync('packages/phase6-live-worker/src/index.ts', 'utf8');
  const store = fs.readFileSync('packages/db/src/index.ts', 'utf8');
  assert.match(worker, /refreshTerminalOpenChunkTruth/);
  assert.match(worker, /P6_OPEN_CHUNK_EXPIRED_NO_CHAIN_EFFECT/);
  assert.match(worker, /reconcileRecoveredChunkedOpen/);
  assert.match(worker, /rebroadcastExactSignedTransaction/);
  assert.match(store, /async reconcileRecoveredChunkedOpenPlan\(v\)/);
  const start = store.indexOf('async reconcileRecoveredChunkedOpenPlan(v)');
  const end = store.indexOf('async upsertOwnedPosition(v)', start);
  const method = store.slice(start, end);
  assert.match(method, /String\(currentRow\.action\)!=='OPEN'/);
  assert.match(method, /\['EXPIRED','RECONCILIATION_REQUIRED'\]/);
  assert.match(method, /'CONFIRMED','PROVEN_NOT_LANDED','CONFIRMED_FAILED','FAILED_PRE_SIGN','EXPIRED_PRE_SUBMISSION'/);
  assert.match(method, /chunks\.rows\.length<2\|\|confirmed<1\|\|unresolved>0/);
});
