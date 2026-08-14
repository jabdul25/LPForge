import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

test('a reconciled OPEN resolves a stale partial-entry recovery before any unwind path', () => {
  const worker = fs.readFileSync('packages/phase6-live-worker/src/index.ts', 'utf8');
  const loadPlan = worker.indexOf('const plan = await input.store.loadAutonomousPlan(planId);');
  const reconciled = worker.indexOf('plan?.action === "OPEN" && plan.state === "RECONCILED"', loadPlan);
  const unwindSubmitted = worker.indexOf('if (state === "UNWIND_SUBMITTED")', loadPlan);
  const genericUnwindHold = worker.indexOf('if (state !== "ENTRY_FUNDED_NOT_OPEN" && state !== "RESUME_OPEN")', loadPlan);
  assert.ok(loadPlan >= 0 && reconciled > loadPlan, 'recovery must load plan state first');
  assert.ok(reconciled < unwindSubmitted && reconciled < genericUnwindHold, 'reconciled OPEN must resolve before unwind handling');
  assert.match(worker, /P6_PARTIAL_OPEN_RECONCILED_AFTER_RECOVERY/);
  assert.match(worker, /state: "RESOLVED"/);
});

test('autonomous plan mapping preserves the durable transaction-plan state', () => {
  const store = fs.readFileSync('packages/db/src/index.ts', 'utf8');
  assert.match(store, /state: String\(row\.state\)/);
  assert.match(store, /SELECT p\.plan_id,p\.intent_id,p\.state,p\.expires_at/);
});
