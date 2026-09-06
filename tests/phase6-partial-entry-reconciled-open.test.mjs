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
  const genericUnwindHold = worker.indexOf('if (state !== "ENTRY_FUNDED_NOT_OPEN" && state !== "RESUME_OPEN")', loadPlan);
  assert.ok(loadPlan >= 0 && construction > loadPlan && reconciled > construction, 'recovery must check construction and an authoritative owned-position binding first');
  assert.ok(partialHold > reconciled && partialHold < unwindSubmitted && partialHold < genericUnwindHold, 'incomplete construction remains in protective recovery rather than becoming ordinary OPEN');
  assert.match(worker, /P6_PARTIAL_RECOVERY_SUPERSEDED_BY_SUCCESSFUL_ENTRY/);
  assert.match(worker, /state: "SUPERSEDED_BY_SUCCESSFUL_ENTRY"/);
  assert.match(worker, /A payload address alone is never sufficient/);
  assert.match(worker, /positionOpenReconciled/);
  assert.match(worker, /supersedeProvisionalPartialEntryRecovery/);
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
