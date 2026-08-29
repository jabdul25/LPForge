import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

test('reshape funds replacement from measured post-removal wallet deltas, not stale PositionV2 amounts',()=>{
  const src=fs.readFileSync('packages/phase6-live-worker/src/index.ts','utf8');
  const start=src.indexOf('async function executeManagementReplacement');
  const end=src.indexOf('type CloseSettlementStage',start);
  const fn=src.slice(start,end);
  assert.match(fn,/tokenXBeforeRemove/);
  assert.match(fn,/tokenXAfterRemove/);
  assert.match(fn,/WALLET_DELTA_AFTER_REMOVAL/);
  assert.ok(fn.indexOf('totalPairedTokenRaw: actualX.toString()')>fn.indexOf('tokenXAfterRemove'));
  assert.ok(fn.indexOf('solForLpLamports: actualY.toString()')>fn.indexOf('tokenYAfterRemove'));
  assert.ok(!fn.includes('totalPairedTokenRaw: old.totalXAmount'));
  for(const token of ['RESHAPE_SETTLEMENT','CLOSE_WITHDRAWAL','settlePositionInventoryLot','MEASURED_REPLACEMENT_DEPOSIT'])assert.match(fn,new RegExp(token));
});
