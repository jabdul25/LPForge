import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

test('a confirmed entry makes its unused compensation unwind terminal no-effect', () => {
  const source = fs.readFileSync('packages/db/src/index.ts', 'utf8');
  assert.match(source, /link\.role='ENTRY'/);
  assert.match(source, /opened\.kind='METEORA_OPEN'/);
  assert.match(source, /opened_confirmation\.status IN \('CONFIRMED','FINALIZED'\)/);
  assert.match(source, /THEN 'SKIPPED_NO_EFFECT'/);
});

test('an unsigned entry compensation unwind is not skipped without a confirmed open receipt', () => {
  const source = fs.readFileSync('packages/db/src/index.ts', 'utf8');
  assert.match(source, /EXISTS\(SELECT 1 FROM execution\.transaction_steps opened/);
  assert.doesNotMatch(source, /link\.role='ENTRY' AND p\.state='RECONCILED'/);
});
