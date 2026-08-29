import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import {buildTransactionPlan} from '../.build/packages/transaction-planner/src/index.js';

const owner='11111111111111111111111111111111',position='Vote111111111111111111111111111111111111',now='2026-08-13T12:00:00.000Z',expires='2026-08-13T12:05:00.000Z';
function plan(action){return buildTransactionPlan({action,cluster:'mainnet-beta',ownerAddress:owner,poolAddress:'POOL_FIXTURE',...(action==='OPEN'?{}:{positionAddress:position}),...(action==='RESHAPE'||action==='REBALANCE'?{replacementPositionAddress:'Stake11111111111111111111111111111111111111'}:{}),thesisId:'thesis',observedAt:now,expiresAt:expires,...(['OPEN','ADD','RESHAPE','REBALANCE'].includes(action)?{capitalLamports:20_000_000n}:{}),...(['OPEN','RESHAPE','REBALANCE','ADD'].includes(action)?{lowerBinId:-10,upperBinId:10,strategy:'SPOT'}:{}),...(action==='REDUCE'?{reductionBps:5000}:{})});}

test('P6 lifecycle planner has executable transaction kinds for every managed action',()=>{
  assert.equal(plan('OPEN').transactions.at(-1).kind,'METEORA_OPEN');
  assert.equal(plan('ADD').transactions[0].kind,'METEORA_ADD');
  assert.equal(plan('CLAIM').transactions[0].kind,'METEORA_CLAIM');
  assert.equal(plan('REDUCE').transactions[0].kind,'METEORA_REMOVE');
  // A close is a drain → unwind → close sequence: liquidity out, token-X
  // proceeds swapped into the SOL-side token, then the empty account closed.
  assert.deepEqual(plan('CLOSE').transactions.map(x=>x.kind),['METEORA_REMOVE','JUPITER_UNWIND','METEORA_CLOSE']);
  assert.deepEqual(plan('EMERGENCY_CLOSE').transactions.map(x=>x.kind),['METEORA_REMOVE','JUPITER_UNWIND','METEORA_CLOSE']);
  assert.equal(plan('CLOSE').transactions[0].metadata.claimAndClose,false);
  assert.equal(plan('CLOSE').transactions[0].metadata.bps,10_000);
  assert.equal(plan('CLOSE').transactions.at(-1).metadata.claimAndClose,true);
  assert.deepEqual(plan('RESHAPE').transactions.map(x=>x.kind),['METEORA_CLOSE','METEORA_OPEN']);
  assert.deepEqual(plan('REBALANCE').transactions.map(x=>x.kind),['METEORA_CLOSE','METEORA_OPEN']);
});

test('P6 live execution accepts only local private-key owner signing and runs recovery first',()=>{
  const src=fs.readFileSync(new URL('../apps/execution/src/main.ts',import.meta.url),'utf8');
  assert.match(src,/OWNER_SIGNER_MODE_LOCAL_PRIVATE_KEY_REQUIRED/);
  assert.match(src,/recoverOnce\(\)/);
  assert.match(src,/claimNextAutonomousPlan/);
  assert.doesNotMatch(src,/createRemoteKmsHttpSigner/);
  assert.doesNotMatch(src,/createLocalKeypairFileSigner/);
});

test('P6 lifecycle persistence migration adds ownership, observations, partial entry recovery, and state events',()=>{
  const sql=fs.readFileSync(new URL('../packages/db/migrations/M0029_live_position_lifecycle.sql',import.meta.url),'utf8');
  for(const table of ['plan_state_events','owned_positions','position_observations','partial_entry_recovery'])assert.match(sql,new RegExp(`execution\\.${table}`));
});
