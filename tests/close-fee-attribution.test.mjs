import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { deriveCloseFeeAttributionAccounting } from '../.build/packages/db/src/index.js';

const WSOL='So11111111111111111111111111111111111111112';
const base={tokenXMint:'TokenX',tokenYMint:WSOL,tokenXDecimals:6,tokenYDecimals:9,closeTokenXRaw:1000n,closeTokenYRaw:200n,closeNativeLamports:200n,swapProceedsLamports:10_000n,explicitClaimLamports:50n,rewardLamports:0n,initialCapitalLamports:9_000n,transactionCostLamports:10n,rentLockedLamports:100n,rentRecoveredLamports:100n,realizedSolPnlLamports:1_240n};

test('pre-remove accrued fees receive a receipt-bound embedded fee attribution without principal double count',()=>{
  const value=deriveCloseFeeAttributionAccounting({...base,preCloseFeeXRaw:100n,preCloseFeeYRaw:20n});
  assert.equal(value.status,'COMPLETE');
  assert.equal(value.realizedLpFeeValueLamports,1020n);
  assert.equal(value.principalReturnedValueLamports,9180n);
  assert.equal(value.inventoryUnwindResultLamports,180n);
  assert.equal(value.accountingReconciliationDifferenceLamports,0n);
});

test('explicit native SOL claim remains separate fee income and zero is proven only by a zero PositionV2 snapshot',()=>{
  const value=deriveCloseFeeAttributionAccounting({...base,preCloseFeeXRaw:0n,preCloseFeeYRaw:0n,realizedSolPnlLamports:1_240n-1020n});
  assert.equal(value.status,'COMPLETE');
  assert.equal(value.realizedLpFeeValueLamports,0n);
  assert.equal(value.embeddedRemoveFeeXRaw,0n);
  assert.equal(value.embeddedRemoveFeeYRaw,0n);
});

test('missing fee valuation or token metadata is partial rather than synthetic zero',()=>{
  const unavailable=deriveCloseFeeAttributionAccounting({...base,closeTokenXRaw:undefined,swapProceedsLamports:0n,preCloseFeeXRaw:100n,preCloseFeeYRaw:0n});
  assert.equal(unavailable.status,'PARTIAL');
  assert.ok(unavailable.reasonCodes.includes('FEE_X_VALUATION_UNAVAILABLE'));
  const missingDecimals=deriveCloseFeeAttributionAccounting({...base,tokenXDecimals:undefined,preCloseFeeXRaw:0n,preCloseFeeYRaw:0n});
  assert.equal(missingDecimals.status,'PARTIAL');
  assert.ok(missingDecimals.reasonCodes.includes('TOKEN_X_DECIMALS_UNAVAILABLE'));
});

test('M0063 keeps a close-plan-bound immutable raw fee snapshot and never stores rewards as LP fees',async()=>{
  const migration=await readFile(new URL('../packages/db/migrations/M0063_close_fee_attribution.sql',import.meta.url),'utf8');
  const worker=await readFile(new URL('../packages/phase6-live-worker/src/index.ts',import.meta.url),'utf8');
  assert.match(migration,/close_plan_id text PRIMARY KEY/);
  const db=await readFile(new URL('../packages/db/src/index.ts',import.meta.url),'utf8');
  assert.match(migration,/pre_close_fee_x_raw numeric NOT NULL/);
  assert.match(migration,/pre_close_reward_one_raw numeric NOT NULL/);
  assert.match(migration,/close fee snapshot is immutable/);
  assert.match(worker,/upsertCloseFeeAttributionSnapshot/);
  assert.match(db,/POSITION_V2_PRE_CLOSE_REMOVE/);
  assert.match(worker,/finalizeCloseFeeAttribution/);
  assert.match(worker,/tokenMint:WSOL_MINT,tokenAmountRaw:gross\.toString\(\)/);
});

test('close-decision authority remains independent from attribution persistence',async()=>{
  const worker=await readFile(new URL('../packages/phase6-live-worker/src/index.ts',import.meta.url),'utf8');
  const closeAt=worker.indexOf('async function executeCloseSettlement');
  const snapshotAt=worker.indexOf('upsertCloseFeeAttributionSnapshot',closeAt);
  const removeAt=worker.indexOf('buildRemoveLiquidityTransactions',closeAt);
  assert.ok(snapshotAt>closeAt&&snapshotAt<removeAt);
  assert.doesNotMatch(worker.slice(closeAt,snapshotAt),/assessLiveExit|positionContinuationEv|expectedCloseCost/);
});

