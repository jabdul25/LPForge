import test from 'node:test';
import assert from 'node:assert/strict';
import {recoverUnfinishedAutonomousPlans,reconcileOrphanedPositions} from '../.build/packages/phase6-live-worker/src/index.js';

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
  assert.match(db,/WHERE plan_id=\$1 AND state IN \('PLAN_CREATED','BUILT','SIMULATED','APPROVED','SIGNED'\)/);
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

test('orphan sweep is a no-op without an owner or pool set',async()=>{
  const upserts=[];
  const store={async loadOwnedPositions(){return[];},async upsertOwnedPosition(v){upserts.push(v);}};
  const result=await reconcileOrphanedPositions({store,rpcUrl:'http://rpc',programId:'program',ownerAddress:'',poolAddresses:['pool'],positionsProvider:async()=>[]});
  assert.deepEqual(result,{adopted:0,reasonCodes:[]});
  assert.equal(upserts.length,0);
});

test('orphan sweep adopts unknown owned-identity positions and skips known or foreign rows',async()=>{
  const upserts=[];
  const store={
    async loadOwnedPositions(){return[{position_address:'KNOWN'}];},
    async upsertOwnedPosition(v){upserts.push(v);},
  };
  const facts={
    pool:async()=>[
      {positionAddress:'KNOWN',owner:'OWNER',pool:'pool',lowerBinId:10,upperBinId:20},
      {positionAddress:'FOREIGN',owner:'OTHER',pool:'pool',lowerBinId:10,upperBinId:20},
      {positionAddress:'WRONG_POOL',owner:'OWNER',pool:'other',lowerBinId:10,upperBinId:20},
      {positionAddress:'ORPHAN',owner:'OWNER',pool:'pool',lowerBinId:30,upperBinId:40},
    ],
    other:async()=>[],
  };
  const result=await reconcileOrphanedPositions({store,rpcUrl:'http://rpc',programId:'program',ownerAddress:'OWNER',poolAddresses:['pool','other'],now:'2026-08-14T00:00:00.000Z',positionsProvider:async(pool)=>facts[pool]()});
  assert.equal(result.adopted,1);
  assert.deepEqual(result.reasonCodes,['P6_ORPHAN_POSITION_DETECTED']);
  assert.equal(upserts.length,1);
  assert.equal(upserts[0].positionAddress,'ORPHAN');
  assert.equal(upserts[0].initialCapitalLamports,0n);
  assert.equal(upserts[0].lifecycleState,'RECONCILIATION_REQUIRED');
  assert.equal(upserts[0].reconciliationStatus,'MISMATCH');
  assert.equal(upserts[0].payload.orphanDetected,true);
});

test('orphan sweep reports a pool read failure without disrupting other pools',async()=>{
  const upserts=[];
  const store={async loadOwnedPositions(){return[];},async upsertOwnedPosition(v){upserts.push(v);}};
  const result=await reconcileOrphanedPositions({store,rpcUrl:'http://rpc',programId:'program',ownerAddress:'OWNER',poolAddresses:['broken','ok'],positionsProvider:async(pool)=>{if(pool==='broken')throw new Error('rpc down');return[{positionAddress:'ORPHAN',owner:'OWNER',pool:'ok',lowerBinId:1,upperBinId:2}];}});
  assert.equal(result.adopted,1);
  assert.deepEqual(result.reasonCodes,['P6_ORPHAN_SWEEP_POOL_READ_FAILED','P6_ORPHAN_POSITION_DETECTED']);
});
