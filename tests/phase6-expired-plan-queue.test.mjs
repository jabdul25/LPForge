import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

test('P6 finalizes expired planned plans before attempting an autonomous claim', () => {
  const source = fs.readFileSync(
    new URL('../packages/db/src/index.ts', import.meta.url),
    'utf8',
  );

  assert.match(source, /UPDATE execution\.transaction_plans[\s\S]*?state='EXPIRED'/);
  assert.match(source, /P6_PLAN_EXPIRED_BEFORE_CLAIM/);
  assert.match(source, /'PLANNED','EXPIRED'/);
  assert.match(source, /p\.state='PLANNED' AND p\.expires_at>\$1::timestamptz/);
});
