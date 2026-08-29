import test from 'node:test';
import assert from 'node:assert/strict';
import {recoverUnfinishedAutonomousPlans,reconcileWalletWidePositions} from '../.build/packages/phase6-live-worker/src/index.js';

test('orphan sweep targets the installed Meteora SDK wallet-position API',async()=>{
  const fs=await import('node:fs/promises');
  const worker=await fs.readFile('packages/phase6-live-worker/src/index.ts','utf8');
  const sdk=await fs.readFile('packages/meteora-execution/src/index.ts','utf8');
  assert.match(worker,/getAllLbPairPositionsByUser/);
  assert.doesNotMatch(worker,/getPositionsByUserAndLbPair/);
  assert.match(sdk,/getAllLbPairPositionsByUser/);
});

test('capital reconciliation releases a deployed reservation only after its recorded PositionV2 is CLOSED',async()=>{
  const fs=await import('node:fs/promises');
  const db=await fs.readFile('packages/db/src/index.ts','utf8');
  assert.match(db,/r\.state IN \('RESERVED','SUBMITTED','DEPLOYED'\)/);
  assert.match(db,/r\.state='DEPLOYED' AND EXISTS\(SELECT 1 FROM execution\.owned_positions o WHERE o\.entry_plan_id=r\.plan_id AND o\.lifecycle_state='CLOSED'\) THEN 'RELEASED'/);
  assert.match(db,/P6_CAPITAL_POSITION_CLOSED_RECONCILED/);
  assert.doesNotMatch(db,/r\.state='DEPLOYED' THEN 'RELEASED'/);
});

test('terminal plans terminalize pre-send journals and P7 excludes terminal parent plans from active-journal health',async()=>{
  const fs=await import('node:fs/promises');
  const db=await fs.readFile('packages/db/src/index.ts','utf8');
  assert.match(db,/WHERE plan_id=\$1 AND state IN \('PLAN_CREATED','BUILT','SIMULATED','APPROVED','SIGNING','SIGNED','SUBMITTED','UNKNOWN_SUBMISSION','CONFIRMED','RECONCILIATION_REQUIRED'\)/);
  assert.match(db,/JOIN execution\.transaction_plans p ON p\.plan_id=j\.plan_id WHERE j\.state NOT IN \('RECONCILED','EXPIRED','FAILED','HOLD'\) AND p\.state NOT IN \('BLOCKED','FAILED','EXPIRED','RECONCILED'\)/);
});

test('P6 recovery terminalizes an unsubmitted claimed plan and releases any reservation',async()=>{
  const calls=[];
  const store={
    async loadUnresolvedAutonomousPlans(){return[{planId:'plan-orphan',idempotencyKey:'idem-orphan',action:'CLAIM',poolAddress:'pool',ownerAddress:'owner',positionAddress:'position',expiresAt:'2030-01-01T00:00:00.000Z'}];},
    async getExecutionJournal(){return{journal_id:'journal-orphan',idempotency_key:'idem-orphan',plan_id:'plan-orphan',state:'PLAN_CREATED',version:1,updated_at:'2026-08-14T00:00:00.000Z',payload:{}};},
    async updateExecutionJournal(value){calls.push(['journal',value]);return true;},
    async completeAutonomousPlan(value){calls.push(['complete',value]);},
    async transitionAutonomousPlan(value){calls.push(['transition',value]);},
    async releaseExecutionCapital(...value){calls.push(['release',value]);},
  };
  const result=await recoverUnfinishedAutonomousPlans({store,currentBlockHeight:1,now:'2026-08-14T00:01:00.000Z'});
  assert.equal(result[0].action,'RETURN_EXISTING_PLAN');
  assert.deepEqual(result[0].reasonCodes,['P6_RECOVERY_PRE_SUBMISSION_ABORTED']);
  assert.equal(calls.find(([kind])=>kind==='journal')[1].state,'FAILED');
  assert.equal(calls.find(([kind])=>kind==='complete')[1].state,'FAILED');
  assert.deepEqual(calls.find(([kind])=>kind==='release')[1],['plan-orphan','2026-08-14T00:01:00.000Z',['P6_RECOVERY_PRE_SUBMISSION_ABORTED']]);
});

test('P6 recovery terminalizes a claimed plan that never reached durable journaling',async()=>{
  const calls=[];
  const store={
    async loadUnresolvedAutonomousPlans(){return[{planId:'plan-no-journal',idempotencyKey:'idem-no-journal',action:'OPEN',poolAddress:'pool',ownerAddress:'owner',expiresAt:'2030-01-01T00:00:00.000Z'}];},
    async getExecutionJournal(){return undefined;},
    async completeAutonomousPlan(value){calls.push(['complete',value]);},
    async transitionAutonomousPlan(value){calls.push(['transition',value]);},
    async releaseExecutionCapital(...value){calls.push(['release',value]);},
  };
  const result=await recoverUnfinishedAutonomousPlans({store,currentBlockHeight:1,now:'2026-08-14T00:01:00.000Z'});
  assert.deepEqual(result[0].reasonCodes,['P6_RECOVERY_JOURNAL_MISSING_PRE_SUBMISSION_ABORTED']);
  assert.equal(calls.find(([kind])=>kind==='complete')[1].state,'FAILED');
  assert.deepEqual(calls.find(([kind])=>kind==='release')[1],['plan-no-journal','2026-08-14T00:01:00.000Z',['P6_RECOVERY_JOURNAL_MISSING_PRE_SUBMISSION_ABORTED']]);
});

test('P6 recovery status-read failure never rebuilds an expired submitted plan',async()=>{
  const calls=[];
  const store={
    async loadUnresolvedAutonomousPlans(){return[{planId:'plan-status-unknown',idempotencyKey:'idem-status-unknown',action:'OPEN',poolAddress:'pool',ownerAddress:'owner',expiresAt:'2030-01-01T00:00:00.000Z'}];},
    async getExecutionJournal(){return{journal_id:'journal-status-unknown',idempotency_key:'idem-status-unknown',plan_id:'plan-status-unknown',state:'SUBMITTED',signature:'sig',last_valid_block_height:1,version:3,updated_at:'2026-08-14T00:00:00.000Z',payload:{action:'OPEN'}};},
    async transitionAutonomousPlan(value){calls.push(value);},
  };
  const result=await recoverUnfinishedAutonomousPlans({store,currentBlockHeight:2,now:'2026-08-14T00:01:00.000Z',signatureStatusProvider:async()=>{throw new Error('rpc unavailable');}});
  assert.deepEqual(result,[{planId:'plan-status-unknown',action:'HOLD_FOR_OPERATOR',reasonCodes:['P6_RECOVERY_SIGNATURE_STATUS_READ_UNKNOWN']}]);
  assert.equal(calls[0].state,'RECOVERING');
  assert.deepEqual(calls[0].reasonCodes,['P6_RECOVERY_SIGNATURE_STATUS_READ_UNKNOWN']);
});

test('P6 expires an absent close child without resending and releases the manager to build a fresh protective plan',async()=>{
  const calls=[];
  const plan={planId:'close-expired',idempotencyKey:'close-expired-idem',action:'EMERGENCY_CLOSE',poolAddress:'pool',ownerAddress:'owner',positionAddress:'POSITION',expiresAt:'2030-01-01T00:00:00.000Z',planPayload:{autonomous_dispatch:{pendingStage:'CLOSE_REMOVE_SUBMITTED',pendingSignature:'expired-close-signature'}}};
  const store={
    async loadUnresolvedAutonomousPlans(){return[plan];},
    async getExecutionJournal(){return{journal_id:'journal-close-expired',idempotency_key:plan.idempotencyKey,plan_id:plan.planId,state:'SUBMITTED',signature:'expired-close-signature',last_valid_block_height:1,version:1,updated_at:'2026-08-29T00:00:00.000Z',payload:{action:'EMERGENCY_CLOSE'}};},
    async markSubmissionExpired(...value){calls.push(['expired',value]);},
    async updateExecutionJournal(value){calls.push(['journal',value]);return true;},
    async completeAutonomousPlan(value){calls.push(['complete',value]);},
  };
  // The test invokes the recovery path with a known-expired signature and an
  // independently present position.  The close child cannot be resent.
  const worker=await import('../.build/packages/phase6-live-worker/src/index.js');
  const src=await (await import('node:fs/promises')).readFile('packages/phase6-live-worker/src/index.ts','utf8');
  assert.ok(worker.recoverUnfinishedAutonomousPlans,'recovery remains exported');
  assert.match(src,/markSubmissionExpired\(closePending\.signature/,'the exact sent signature is terminalized');
  assert.match(src,/P6_CLOSE_PENDING_STAGE_EXPIRED_NO_CHAIN_EFFECT/,'expired close children have an explicit no-effect recovery classification');
  assert.match(src,/positionTruth\.exists === true/,'a fresh close is only allowed after independently proving that the position remains open');
  assert.match(src,/loadSubmissionAttemptBySignature\(recoverySignature\)/,'recovery obtains the original blockhash lifetime from the durable submission row');
  const db=await (await import('node:fs/promises')).readFile('packages/db/src/index.ts','utf8');
  assert.match(db,/SELECT last_valid_block_height FROM execution\.submission_attempts WHERE signature=\$1/,'the fallback is scoped to the exact durable signature');
  assert.equal(calls.length,0,'source-level contract check does not execute a live RPC path');
});

test('P6 CLOSE recovery reconciles a confirmed native-SOL unwind exactly once before resuming',async()=>{
  const owner='OWNER',risk='RISK',wsol='WSOL',position='POSITION',jupiter='JUP6LkbZbjS1jKKwapdHNy74zcZ3tLUZoi5QNyVTaV4',
    receipt={slot:1,version:0,transaction:{message:{accountKeys:[owner,risk,wsol,position],compiledInstructions:[{programId:jupiter,accountKeyIndexes:[0,1],parsed:{type:'route',info:{destination:owner}}}]}},meta:{err:null,fee:5,preBalances:[1000,0,1,0],postBalances:[1005,0,1,0],loadedAddresses:{writable:[],readonly:[]},preTokenBalances:[{accountIndex:1,mint:risk,owner,uiTokenAmount:{amount:'50',decimals:9}}],postTokenBalances:[{accountIndex:1,mint:risk,owner,uiTokenAmount:{amount:'0',decimals:9}}],innerInstructions:[]}},
    transitions=[],cashflows=new Map(),lots=new Map(),plan={planId:'close-plan',idempotencyKey:'close-idem',action:'CLOSE',poolAddress:'pool',ownerAddress:owner,positionAddress:position,expiresAt:'2030-01-01T00:00:00.000Z',planPayload:{autonomous_dispatch:{stage:'CLOSE_INVENTORY_MEASURED',pendingStage:'CLOSE_UNWIND_SUBMITTED',pendingSignature:'unwind-sig',tokenXMint:risk,attributableTokenX:'50',unwindTransactionId:'unwind'}}},
    store={
      async loadUnresolvedAutonomousPlans(){return[plan];},
      async getExecutionJournal(){return{journal_id:'journal',idempotency_key:'close-idem',plan_id:'close-plan',state:'SUBMITTED',signature:'unwind-sig',version:1,updated_at:'2026-08-22T00:00:00.000Z',payload:{}};},
      async insertPositionCashflow(value){cashflows.set(value.cashflowId,value);},
      async settlePositionInventoryLot(value){lots.set(value.eventId,value);},
      async transitionAutonomousPlan(value){transitions.push(value);},
    },
    input={store,currentBlockHeight:1,now:'2026-08-22T00:01:00.000Z',connection:{async getTransaction(){return receipt;}},signatureStatusProvider:async()=>({err:null,confirmationStatus:'confirmed'})};
  const first=await recoverUnfinishedAutonomousPlans(input),second=await recoverUnfinishedAutonomousPlans(input);
  assert.equal(first[0].action,'RESUME_CLOSE_SETTLEMENT');
  assert.equal(second[0].action,'RESUME_CLOSE_SETTLEMENT');
  assert.equal(cashflows.size,1);
  assert.equal(lots.size,1);
  assert.equal(cashflows.get('close-plan:close-swap-proceeds').lamports,10n);
  assert.ok(transitions.every(value=>!value.reasonCodes?.includes('P6_CLOSE_UNWIND_OUTPUT_MISSING')));
});

test('wallet-wide reconciliation is a no-op without an owner',async()=>{
  const result=await reconcileWalletWidePositions({store:{},rpcUrl:'http://rpc',programId:'program',ownerAddress:''});
  assert.deepEqual(result,{scanned:0,known:0,adopted:0,unknown:0,ambiguous:0,dbOnly:0,reasonCodes:[]});
});

test('wallet-wide reconciliation records an unknown signer position without adopting it',async()=>{
  const discoveries=[],upserts=[];
  const store={
    async loadOwnedPositions(){return[];},
    async findAutonomousOpenPlansByPosition(){return[];},
    async upsertWalletPositionDiscovery(v){discoveries.push(v);},
    async upsertOwnedPosition(v){upserts.push(v);},
  };
  const result=await reconcileWalletWidePositions({store,rpcUrl:'http://rpc',programId:'program',ownerAddress:'OWNER',now:'2026-08-14T00:00:00.000Z',walletPositionsProvider:async()=>[{positionAddress:'MANUAL',owner:'OWNER',pool:'pool',lowerBinId:30,upperBinId:40}]});
  assert.equal(result.unknown,1);
  assert.equal(result.adopted,0);
  assert.equal(upserts.length,0);
  assert.equal(discoveries[0].classification,'UNKNOWN_WALLET_POSITION');
});

test('August-14 regression: a confirmed LPForge OPEN missing persistence is recovered exactly once from wallet plus journal evidence',async()=>{
  const discoveries=[],upserts=[],reconciliations=[];
  const plan={planId:'plan-aug14',idempotencyKey:'idem-aug14',state:'RECONCILIATION_REQUIRED',action:'OPEN',poolAddress:'POOL',ownerAddress:'OWNER',thesisId:'thesis',observedAt:'2026-08-14T15:00:00.000Z',expiresAt:'2026-08-14T15:05:00.000Z',intentPayload:{entryFunding:{orientation:'ONE_SIDED_Y'}},planPayload:{intent:{capitalLamports:'30000000',lowerBinId:10,upperBinId:20,activeBinId:15,strategy:'CURVE'}},steps:[]};
  const store={
    async loadOwnedPositions(){return[];},
    async findAutonomousOpenPlansByPosition(){return[plan];},
    async getExecutionJournal(){return{journal_id:'journal-aug14',signature:'open-signature',state:'SUBMITTED',updated_at:'2026-08-14T15:00:01.000Z'};},
    async upsertOwnedPosition(v){upserts.push(v);},
    async insertExecutionReconciliation(v){reconciliations.push(v);},
    async upsertWalletPositionDiscovery(v){discoveries.push(v);},
  };
  const input={store,rpcUrl:'http://rpc',programId:'program',ownerAddress:'OWNER',now:'2026-08-14T15:01:00.000Z',walletPositionsProvider:async()=>[{positionAddress:'DuHztt67NUT819AAaqJftEGWGQCyxa3DmLsJS4cZaisj',owner:'OWNER',pool:'POOL',lowerBinId:10,upperBinId:20,chainSlot:123456n}]};
  const first=await reconcileWalletWidePositions(input),second=await reconcileWalletWidePositions(input);
  assert.equal(first.adopted,1);
  assert.equal(second.adopted,1);
  assert.equal(upserts.length,2);
  assert.deepEqual(upserts[0],upserts[1]);
  assert.equal(upserts[0].entryPlanId,'plan-aug14');
  assert.equal(upserts[0].entrySignature,'open-signature');
  assert.equal(upserts[0].entrySlot,123456n);
  assert.equal(upserts[0].initialCapitalLamports,30000000n);
  assert.equal(reconciliations.length,2);
  assert.equal(discoveries[0].classification,'KNOWN_LPFORGE_POSITION');
});

test('wallet-wide reconciliation marks a DB-only active position as reconciliation debt',async()=>{
  const discoveries=[],lifecycle=[];
  const store={
    async loadOwnedPositions(){return[{position_address:'DB_ONLY',lpforge_position_id:'position-DB_ONLY',pool_address:'POOL',last_plan_id:'plan'}];},
    async upsertWalletPositionDiscovery(v){discoveries.push(v);},
    async markOwnedPositionLifecycle(v){lifecycle.push(v);},
  };
  const result=await reconcileWalletWidePositions({store,rpcUrl:'http://rpc',programId:'program',ownerAddress:'OWNER',now:'2026-08-14T00:00:00.000Z',walletPositionsProvider:async()=>[]});
  assert.equal(result.dbOnly,1);
  assert.equal(discoveries[0].classification,'DB_ONLY');
  assert.equal(lifecycle[0].lifecycleState,'RECONCILIATION_REQUIRED');
});
