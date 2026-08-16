import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import {
  deriveEntryFundingSettlement,
  deriveOpenResidualInventory,
} from '../.build/packages/phase6-live-worker/src/index.js';

test('entry funding is measured from combined native-SOL/WSOL and paired-token wallet deltas',()=>{
  const actual=deriveEntryFundingSettlement({
    nativeLamportsBefore:1_000_000n,nativeLamportsAfter:890_000n,
    wsolRawBefore:50_000n,wsolRawAfter:20_000n,
    pairedTokenRawBefore:700n,pairedTokenRawAfter:1_200n,
    transactionFeeLamports:10_000n,
  });
  assert.equal(actual.solAssetOutLamports,130_000n);
  assert.equal(actual.transactionFeeLamports,10_000n);
  assert.equal(actual.pairedTokenReceivedRaw,500n);
});

test('only new funding left after OPEN becomes attributed residual inventory',()=>{
  assert.equal(deriveOpenResidualInventory({
    pairedTokenRawBeforeFunding:1_000n,
    pairedTokenRawBeforeOpen:1_500n,
    pairedTokenRawAfterOpen:1_125n,
    pairedTokenReceivedRaw:500n,
  }),125n);
  assert.equal(deriveOpenResidualInventory({
    pairedTokenRawBeforeFunding:1_000n,
    pairedTokenRawBeforeOpen:1_500n,
    pairedTokenRawAfterOpen:900n,
    pairedTokenReceivedRaw:500n,
  }),0n);
});

test('entry funding and aborted-entry recovery use durable plan cashflows and terminal states',()=>{
  const migration=fs.readFileSync('packages/db/migrations/M0040_plan_cashflows.sql','utf8');
  const worker=fs.readFileSync('packages/phase6-live-worker/src/index.ts','utf8');
  for(const flow of ['ENTRY_FUNDING_SOL_OUT','ENTRY_FUNDING_X_IN','FUNDING_TX_COST','RECOVERY_UNWIND_X_OUT','RECOVERY_SOL_IN','RECOVERY_TX_COST'])assert.match(migration,new RegExp(flow));
  for(const state of ['OPEN_RECOVERED','ABORTED_SOL_SETTLED'])assert.match(migration,new RegExp(state));
  for(const token of ['deriveEntryFundingSettlement','persistOpenResidualInventory','OPEN_RESIDUAL','RECOVERY_UNWIND_X_OUT','ABORTED_SOL_SETTLED'])assert.match(worker,new RegExp(token));
});
