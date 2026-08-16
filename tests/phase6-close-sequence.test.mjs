import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import {buildTransactionPlan} from '../.build/packages/transaction-planner/src/index.js';

const owner='11111111111111111111111111111111',position='Vote111111111111111111111111111111111111',now='2026-08-13T12:00:00.000Z',expires='2026-08-13T12:05:00.000Z';
function plan(action){return buildTransactionPlan({action,cluster:'mainnet-beta',ownerAddress:owner,poolAddress:'POOL_FIXTURE',positionAddress:position,thesisId:'thesis',observedAt:now,expiresAt:expires});}

test('close plans are a drain → unwind → close sequence with one durable step per phase',()=>{
  for(const action of ['CLOSE','EMERGENCY_CLOSE']){
    const p=plan(action);
    assert.deepEqual(p.transactions.map(x=>x.kind),['METEORA_REMOVE','JUPITER_UNWIND','METEORA_CLOSE'],`${action} step kinds`);
    const [remove,unwind,close]=p.transactions;
    assert.equal(remove.metadata.bps,10_000);
    assert.equal(remove.metadata.claimAndClose,false,'the drain must not claim-and-close');
    assert.equal(remove.metadata.unwindStage,'CLOSE_TOKEN_X_UNWIND');
    assert.equal(remove.metadata.emergency,action==='EMERGENCY_CLOSE');
    assert.equal(unwind.metadata.unwindStage,'CLOSE_TOKEN_X_UNWIND');
    assert.equal(unwind.metadata.provider,'JUPITER_METIS');
    assert.deepEqual(unwind.writableAccounts,[]);
    assert.equal(close.metadata.bps,10_000);
    assert.equal(close.metadata.claimAndClose,true);
    assert.equal(close.metadata.emergency,action==='EMERGENCY_CLOSE');
    assert.deepEqual(remove.requiredSignerAddresses,[owner]);
    // The unwind step is a fresh wallet swap, not a position mutation.
    assert.deepEqual(remove.writableAccounts,[position]);
    assert.deepEqual(close.writableAccounts,[position]);
    assert.ok(p.reasonCodes.includes('EXECUTION_MULTI_TRANSACTION_PLAN'));
    for(const [index,tx] of p.transactions.entries())assert.equal(tx.sequence,index+1);
  }
});

test('worker close sequence snapshots → drains → claims → unwinds only attributable token-X → closes',()=>{
  const worker=fs.readFileSync('packages/phase6-live-worker/src/index.ts','utf8');
  const closeAt=worker.indexOf('async function executeCloseSettlement');
  const drainAt=worker.indexOf('deferCompletion: true,',closeAt);
  const snapshotAt=worker.indexOf('[tokenXBefore,tokenYBefore]=await Promise.all',closeAt);
  const claimAt=worker.indexOf('buildClaimTransactions(input.pool, {',drainAt);
  const claimStepAt=worker.indexOf('CLOSE_CLAIM_RESIDUAL',claimAt);
  const unwindAt=worker.indexOf('executeJupiterUnwindStep({',claimStepAt);
  const closeBuilderAt=worker.indexOf('buildClosePositionTransaction(input.pool, {',unwindAt);
  assert.ok(closeAt>=0&&snapshotAt>closeAt&&drainAt>snapshotAt&&claimAt>drainAt&&claimStepAt>claimAt&&unwindAt>claimStepAt&&closeBuilderAt>unwindAt,'close phases must run snapshot → drain → claim → unwind → close in order');
  assert.match(worker,/stage:\s*"CLOSE_TOKEN_X_UNWIND"/);
  assert.match(worker,/reasonPrefix:\s*"P6_CLOSE_UNWIND"/);
  assert.match(worker,/economicReferenceLamports:\s*mutationCapital\(input\.plan\)/,'Jupiter unwind compares SOL fee to the position basis, never raw token units');
  assert.match(worker,/action:\s*closeAction/,'emergency-close semantics propagate through the Jupiter unwind risk gate');
  assert.match(worker,/P6_CLOSE_SETTLEMENT_RECONCILIATION_REQUIRED/,'a child failure after REMOVE is parent-level reconciliation debt, not a clean block');
  assert.match(worker,/pendingStage:\s*"CLOSE_(?:REMOVE|CLAIM|UNWIND|POSITION)_SUBMITTED"/,'every submitted child has a durable parent settlement marker before confirmation');
  assert.match(worker,/LPFORGE_METEORA_CLAIM_NOTHING_TO_CLAIM/);
  assert.match(worker,/idempotencyKey:\s*`\$\{input\.plan\.idempotencyKey\}:\$\{unwindStep\.transactionId\}`/);
  assert.match(worker,/tokenXAfter > tokenXBefore \? tokenXAfter - tokenXBefore : 0n/,'only position-attributable inventory may be unwound');
  assert.match(worker,/tokenYAfter>tokenYBefore\?tokenYAfter-tokenYBefore:0n/,'the close ledger also records the position-attributable SOL-side withdrawal');
  assert.match(worker,/flowType:'SWAP_PROCEEDS'/,'token-X close inventory is represented by its actual SOL-side Jupiter output, not a second marked token-X withdrawal');
  assert.match(worker,/source:'JUPITER_WALLET_DELTA'/,'swap proceeds come from wallet-delta chain truth');
  assert.match(worker,/confirmedTransactionFeeLamports/,'cashflow costs prefer confirmed receipt metadata over an estimate');
  assert.match(worker,/P6_CLOSE_TOKEN_X_RESIDUAL/,'a failed residual-inventory verification becomes reconciliation debt');
  // The drain and claim phases must defer completion: a death between phases
  // leaves a durable stage for recovery rather than marking a half-executed
  // close reconciled or blindly repeating its already-confirmed mutation.
  const drainDefer=worker.slice(closeAt,closeBuilderAt).match(/deferCompletion:\s*true/g);
  assert.ok(drainDefer&&drainDefer.length>=2,'drain and claim phases both defer completion');
  // The final close verifies chain truth before completing the plan.
  const verifyAt=worker.indexOf('CLOSE_CHAIN_VERIFIED');
  const stillPresentAt=worker.indexOf('P6_CLOSE_POSITION_STILL_PRESENT');
  assert.ok(verifyAt>=0&&stillPresentAt>verifyAt,'confirmed close must verify the position vanished');
});

test('chunkable 71–100-bin opens establish the same contribution, rent, and receipt-fee ledger as one-shot opens',()=>{
  const worker=fs.readFileSync('packages/phase6-live-worker/src/index.ts','utf8');
  const chunkAt=worker.indexOf('async function executeChunkableAutonomousOpen');
  const chunk=worker.slice(chunkAt,worker.indexOf('/** Executes one already-claimed plan',chunkAt));
  assert.match(chunk,/flowType:'OPEN_CONTRIBUTION'/);
  assert.match(chunk,/flowType:'RENT_LOCK'/);
  assert.match(chunk,/flowType:'TX_COST'/);
  assert.match(chunk,/completedSteps\.push/,'every confirmed SDK chunk contributes a durable receipt-cost record');
});

test('a confirmed REDUCE rebases the owned cost basis with an audit trail',()=>{
  const worker=fs.readFileSync('packages/phase6-live-worker/src/index.ts','utf8');
  assert.match(worker,/const remainingCapitalLamports =\s*\n?\s*\(capital \* BigInt\(10_000 - reductionBps\)\) \/ 10_000n;/);
  assert.match(worker,/adjustOwnedPositionCapital\(\{/);
  assert.match(worker,/priorCapitalLamports:\s*capital\.toString\(\)/);
  assert.match(worker,/remainingCapitalLamports:\s*remainingCapitalLamports\.toString\(\)/);
  const db=fs.readFileSync('packages/db/src/index.ts','utf8');
  assert.match(db,/capital_adjustments/,'postgres store keeps the adjustment audit trail');
  assert.match(db,/adjustOwnedPositionCapital/);
});

test('close and reduce derive their remove range from chain truth when the intent carries none',()=>{
  const worker=fs.readFileSync('packages/phase6-live-worker/src/index.ts','utf8');
  assert.match(worker,/async function chainMutationRange/);
  assert.match(worker,/getPositionV2\(input\.plan\.poolAddress,\s*\n?\s*input\.positionAddress/);
  const operator=fs.readFileSync('apps/operator/src/main.ts','utf8');
  assert.match(operator,/capitalLamports:\s*position\.initialCapitalLamports/,'REDUCE intent must declare the capital it rebases');
});

test('execution contracts enumerate the close unwind step kind',()=>{
  const contracts=fs.readFileSync('packages/execution-contracts/src/index.ts','utf8');
  assert.match(contracts,/'JUPITER_UNWIND'/);
});
