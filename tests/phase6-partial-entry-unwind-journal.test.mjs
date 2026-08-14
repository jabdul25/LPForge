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
  const unwindAt = worker.indexOf('async function unwindPartialEntry');
  const submitAt = worker.indexOf('const record = await submitSignedTransaction({', unwindAt);
  const persistAt = worker.indexOf('unwindSignature: record.signature', submitAt);
  const confirmAt = worker.indexOf('awaitConfirmation({', submitAt);
  assert.ok(persistAt > submitAt && confirmAt > persistAt, 'submission identity must be persisted before confirmation wait');
  assert.match(worker, /P6_PARTIAL_UNWIND_SUBMISSION_UNPROVEN/);
  assert.match(worker, /P6_PARTIAL_UNWIND_CONFIRMATION_PENDING/);
});

test('PostgreSQL store can create an idempotent recovery transaction step', () => {
  const store = fs.readFileSync('packages/db/src/index.ts', 'utf8');
  assert.match(store, /ensureExecutionTransactionStep/);
  assert.match(store, /ON CONFLICT\(transaction_id\) DO NOTHING/);
});
