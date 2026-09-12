import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { shouldRebuildFinalizedFailedCloseUnwind } from '../.build/packages/phase6-live-worker/src/index.js';

const exact={
  signatureStatusReadUnknown:false,
  confirmationStatus:'FAILED',
  failureFinalized:true,
  planState:'FAILED',
  journalState:'FAILED',
  terminalRecovery:'P6_CLOSE_PENDING_STAGE_FAILED_CONFIRMED_NO_PROTOCOL_EFFECT',
  positionExists:true,
  positionOwner:'owner',
  positionPool:'pool',
  expectedOwner:'owner',
  expectedPool:'pool',
  pendingStage:'CLOSE_UNWIND_SUBMITTED',
  failedReceiptProven:true,
  durableInventoryProven:true,
  confirmedPredecessor:true,
  exactPendingAttempt:true,
  retryCount:0,
};

test('only the exact finalized failed primary unwind can rehydrate once',()=>{
  assert.equal(shouldRebuildFinalizedFailedCloseUnwind(exact),true);
});

test('failure proof, ownership, inventory, predecessor, and identity are mandatory',()=>{
  for(const patch of [
    {signatureStatusReadUnknown:true},
    {confirmationStatus:'UNKNOWN'},
    {failureFinalized:false},
    {planState:'RECONCILING'},
    {journalState:'CONFIRMED'},
    {terminalRecovery:'P6_CLOSE_PENDING_STAGE_EXPIRED_NO_CHAIN_EFFECT'},
    {positionExists:false},
    {positionOwner:'other'},
    {positionPool:'other'},
    {failedReceiptProven:false},
    {durableInventoryProven:false},
    {confirmedPredecessor:false},
    {exactPendingAttempt:false},
  ])assert.equal(shouldRebuildFinalizedFailedCloseUnwind({...exact,...patch}),false);
});

test('a retry is bounded: a failed replacement child cannot self-resend',()=>{
  assert.equal(shouldRebuildFinalizedFailedCloseUnwind({...exact,retryCount:1}),false);
  assert.equal(shouldRebuildFinalizedFailedCloseUnwind({...exact,retryCount:undefined}),false);
});

test('the durable unresolved-plan query reloads the exact legacy failed-close marker',async()=>{
  const source=await readFile(new URL('../packages/db/src/index.ts',import.meta.url),'utf8');
  assert.match(source,/P6_CLOSE_PENDING_STAGE_FAILED_CONFIRMED_NO_PROTOCOL_EFFECT/);
});
