import assert from 'node:assert/strict';
import test from 'node:test';
import {shouldResumeCloseSettlement} from '../.build/packages/phase6-live-worker/src/index.js';

for (const stage of [
  'CLOSE_LIQUIDITY_REMOVED',
  'CLOSE_CLAIMS_SETTLED',
  'CLOSE_INVENTORY_MEASURED',
  'CLOSE_INVENTORY_UNWOUND',
]) {
  test(`confirmed ${stage} resumes only the next close-settlement stage`, () => {
    assert.equal(
      shouldResumeCloseSettlement({
        action: 'CLOSE',
        stage,
        positionExists: true,
        confirmationStatus: 'CONFIRMED',
      }),
      true,
    );
  });
}

test('close recovery never resumes an unconfirmed, absent, or unsnapshotted stage', () => {
  for (const value of [
    {action: 'CLOSE', stage: 'CLOSE_INVENTORY_SNAPSHOTTED', positionExists: true, confirmationStatus: 'CONFIRMED'},
    {action: 'CLOSE', stage: 'CLOSE_CLAIMS_SETTLED', positionExists: true, confirmationStatus: 'UNKNOWN'},
    {action: 'CLOSE', stage: 'CLOSE_INVENTORY_UNWOUND', positionExists: false, confirmationStatus: 'FINALIZED'},
    {action: 'OPEN', stage: 'CLOSE_LIQUIDITY_REMOVED', positionExists: true, confirmationStatus: 'CONFIRMED'},
  ]) assert.equal(shouldResumeCloseSettlement(value), false);
});

test('close workflow preserves every durable settlement stage and resumes from it', async () => {
  const source = await import('node:fs/promises').then(fs => fs.readFile('packages/phase6-live-worker/src/index.ts', 'utf8'));
  const db = await import('node:fs/promises').then(fs => fs.readFile('packages/db/src/index.ts', 'utf8'));
  for (const stage of [
    'CLOSE_INVENTORY_SNAPSHOTTED',
    'CLOSE_LIQUIDITY_REMOVED',
    'CLOSE_CLAIMS_SETTLED',
    'CLOSE_INVENTORY_MEASURED',
    'CLOSE_INVENTORY_UNWOUND',
  ]) assert.match(source, new RegExp(stage));
  assert.match(source, /RESUME_CLOSE_SETTLEMENT/);
  assert.match(source, /P6_RECOVERY_CLOSE_STAGE_RESUME_READY/);
  assert.match(db, /COALESCE\(payload->'autonomous_dispatch','\{\}'::jsonb\)\|\|\$4::jsonb/);
});
