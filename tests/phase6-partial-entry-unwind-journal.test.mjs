import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

test('partial-entry unwind is durably journaled before simulation', () => {
  const worker = fs.readFileSync('packages/phase6-live-worker/src/index.ts', 'utf8');
  const journalAt = worker.indexOf('ensureExecutionTransactionStep({');
  const simulationAt = worker.indexOf('simulateExecutionTransaction({', journalAt);
  assert.ok(journalAt >= 0, 'missing durable recovery-step journal');
  assert.ok(simulationAt > journalAt, 'unwind simulation must follow step journal');
  assert.match(worker, /kind:\s*"JUPITER_UNWIND"/);
});

test('partial-entry unwind persists its signature before confirmation and never treats an unproven legacy send as submitted', () => {
  const worker = fs.readFileSync('packages/phase6-live-worker/src/index.ts', 'utf8');
  // The unwind chain is a shared step: submit, then run the caller's durable
  // persistence hook, and only then wait for confirmation. The partial-entry
  // wrapper passes its UNWIND_SUBMITTED upsert as that hook.
  const stepAt = worker.indexOf('async function executeJupiterUnwindStep');
  const submitAt = worker.indexOf('const record = await submitSignedTransaction({', stepAt);
  const persistHookAt = worker.indexOf('input.afterSubmit', submitAt);
  const confirmAt = worker.indexOf('awaitConfirmation({', submitAt);
  const persistAt = worker.indexOf('unwindSignature: submitted.signature', submitAt);
  assert.ok(stepAt >= 0, 'missing shared unwind step');
  assert.ok(persistHookAt > submitAt && confirmAt > persistHookAt, 'submission identity must be persisted before confirmation wait');
  assert.ok(persistAt > confirmAt, 'the wrapper persists the signature before the shared step confirms');
  assert.match(worker, /P6_PARTIAL_UNWIND_SUBMISSION_UNPROVEN/);
  assert.match(worker, /P6_PARTIAL_UNWIND_CONFIRMATION_PENDING/);
});

test('PostgreSQL store can create an idempotent recovery transaction step', () => {
  const store = fs.readFileSync('packages/db/src/index.ts', 'utf8');
  assert.match(store, /ensureExecutionTransactionStep/);
  assert.match(store, /ON CONFLICT\(transaction_id\) DO NOTHING/);
});
